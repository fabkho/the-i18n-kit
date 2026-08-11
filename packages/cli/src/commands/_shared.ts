import { defineCommand } from 'citty'
import type { CommandDef } from 'citty'
import { log } from '../utils/logger.js'
import { toErrorMessage } from '../utils/errors.js'
import { writeResult } from '../utils/stdout-guard.js'
import { createTranslateFn, resolveProviderBaseUrl, BASE_URL_ENV } from '../llm/providers.js'
import type { LlmProvider } from '../llm/providers.js'
import type { TranslateFn } from '../core/types.js'
import { loadProjectConfig } from '../config/project-config.js'

/** Factory for commands that call an operation and output its result. */
export function createCommand(opts: {
  name: string
  description: string
  args?: Record<string, unknown>
  /**
   * Command-specific CI gate: when it returns true for the (already
   * emitted) result, the process exits non-zero — e.g. `check` failing
   * the build on undefined-key findings. Runs in addition to the generic
   * isTotalFailure check.
   */
  failWhen?: (result: unknown) => boolean
  /**
   * Opt-in CI gates this command accepts. The factory reads the requesting
   * flag off args and evaluates every gate uniformly, so no command grows
   * bespoke exit logic. Declaring a gate does not add its flag — pair each
   * spec with an entry in `args`.
   */
  gates?: GateSpec[]
  run: (args: any) => Promise<unknown>
}): CommandDef {
  return defineCommand({
    meta: { name: opts.name, description: opts.description },
    args: { ...sharedArgs, ...(opts.args ?? {}) },
    async run({ args }) {
      try {
        const result = await opts.run(args)
        const runFailed = isTotalFailure(result) || (opts.failWhen?.(result) ?? false)
        const decision = resolveExitCode(result, requestedGates(opts.gates ?? [], args), runFailed)
        outputResult(withGateReport(result, decision.tripped), args)
        // Assign only on a non-zero decision: a clean run must leave the exit
        // code exactly as it found it, as it did before gates existed.
        if (decision.code !== EXIT_SUCCESS) process.exitCode = decision.code
      } catch (error) {
        emitErrorResult(error, args)
        process.exitCode = EXIT_RUN_FAILED
      }
    },
  }) as any
}

/** The run succeeded and no gate tripped. */
export const EXIT_SUCCESS = 0
/** The run itself failed — a bad API key, an unreadable project, a total translate failure. */
export const EXIT_RUN_FAILED = 1
/** The run succeeded but a requested gate tripped — findings exist, the tool worked. */
export const EXIT_GATE_TRIPPED = 2

/**
 * A CI gate a command accepts. `flag` is the arg that requests it; `counter`
 * is the field of `result.summary` carrying the observed value. Omitting
 * `threshold` takes it from the flag's own value, so a boolean flag pairs
 * with `threshold: 0` and a numeric one (`--fail-under 90`) omits it.
 */
export interface GateSpec {
  flag: string
  counter: string
  /** 'above' trips when observed > threshold (default); 'below' when observed < threshold. */
  direction?: 'above' | 'below'
  threshold?: number
}

/** A gate the caller asked for, with its threshold already resolved. */
export interface RequestedGate {
  name: string
  counter: string
  direction: 'above' | 'below'
  threshold: number
}

/** A gate that tripped, as reported in the result. */
export interface TrippedGate extends RequestedGate {
  observed: number
}

export interface ExitDecision {
  code: typeof EXIT_SUCCESS | typeof EXIT_RUN_FAILED | typeof EXIT_GATE_TRIPPED
  tripped: TrippedGate[]
}

/**
 * Pure decision from an operation result plus the gates the caller requested
 * to an exit code. A failed run outranks a tripped gate — exit 1 wins over
 * exit 2 — and gates are not even consulted in that case, because counters
 * from a run that fell over say nothing about the project.
 */
export function resolveExitCode(
  result: unknown,
  gates: RequestedGate[],
  runFailed = false,
): ExitDecision {
  if (runFailed) return { code: EXIT_RUN_FAILED, tripped: [] }

  const tripped: TrippedGate[] = []
  for (const gate of gates) {
    const observed = observedValue(result, gate.counter)
    if (observed === undefined || !trips(gate, observed)) continue
    tripped.push({ ...gate, observed })
  }

  return {
    code: tripped.length > 0 ? EXIT_GATE_TRIPPED : EXIT_SUCCESS,
    tripped,
  }
}

/**
 * Read a gate's counter off result.summary. Works on inline results and on
 * the { reportFile, summary } shape alike, since both carry the summary.
 * A missing or non-numeric counter yields undefined and never trips a gate.
 */
function observedValue(result: unknown, counter: string): number | undefined {
  if (result === null || typeof result !== 'object') return undefined
  const summary = (result as Record<string, unknown>).summary
  if (summary === null || typeof summary !== 'object') return undefined
  const value = (summary as Record<string, unknown>)[counter]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function trips(gate: RequestedGate, observed: number): boolean {
  return gate.direction === 'below' ? observed < gate.threshold : observed > gate.threshold
}

/** Filter the declared gates down to the ones this invocation asked for. */
function requestedGates(specs: GateSpec[], args: Record<string, unknown>): RequestedGate[] {
  const requested: RequestedGate[] = []
  for (const spec of specs) {
    const raw = args[spec.flag]
    if (raw === undefined || raw === null || raw === false || raw === '') continue
    const threshold = spec.threshold ?? Number(raw)
    if (!Number.isFinite(threshold)) continue
    requested.push({
      name: kebabCase(spec.flag),
      counter: spec.counter,
      direction: spec.direction ?? 'above',
      threshold,
    })
  }
  return requested
}

/**
 * Name a tripped gate by the flag that requested it, so the JSON says
 * "fail-on-missing" — what the user typed — rather than "failOnMissing".
 */
function kebabCase(flag: string): string {
  return flag.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
}

/**
 * Attach the gate report without disturbing the rest of the result: consumers
 * parsing today's shape keep working, and a run where nothing tripped is
 * byte-for-byte what it was before gates existed.
 */
function withGateReport(result: unknown, tripped: TrippedGate[]): unknown {
  if (tripped.length === 0) return result
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return result
  return { ...(result as Record<string, unknown>), gatesTripped: tripped }
}

/**
 * True when a run completed but achieved nothing: failures present and zero
 * successes. Covers translate-missing-style results (summary.totalFailed /
 * summary.totalTranslated) and translate-key-style results (top-level
 * failed[] / translated[]). Results without those fields are never a
 * total failure, so unrelated commands are unaffected.
 */
export function isTotalFailure(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const r = result as Record<string, unknown>

  const summary = r.summary
  if (summary !== null && typeof summary === 'object') {
    const s = summary as Record<string, unknown>
    if (typeof s.totalFailed === 'number' && typeof s.totalTranslated === 'number') {
      return s.totalFailed > 0 && s.totalTranslated === 0
    }
  }

  if (Array.isArray(r.failed) && Array.isArray(r.translated)) {
    return r.failed.length > 0 && r.translated.length === 0
  }

  return false
}

const sharedArgs = {
  projectDir: {
    type: 'string' as const,
    alias: 'd',
    description: 'Project directory (default: cwd)',
  },
  json: {
    type: 'boolean' as const,
    description: 'Output as JSON (default for non-TTY)',
    default: false,
  },
}

/** Output result — stdout always carries the result, machine-parseable when piped/--json */
function outputResult(data: unknown, args: { json?: boolean }): void {
  const jsonMode = args.json || !process.stdout.isTTY
  if (
    !jsonMode &&
    data !== null &&
    typeof data === 'object' &&
    'reportFile' in (data as Record<string, unknown>)
  ) {
    const { reportFile, ...rest } = data as Record<string, unknown>
    log.info(`Wrote report to: ${reportFile}`)
    writeResult(JSON.stringify(rest, null, 2) + '\n')
    return
  }
  // JSON mode emits the full result (including reportFile when present) as pure JSON
  writeResult(JSON.stringify(data, null, 2) + '\n')
}

/**
 * Failure output. In JSON mode stdout must still carry parseable JSON —
 * consumers pipe it into jq, and zero bytes is a parse error — so the
 * structured error object IS the result on stdout; the human-readable
 * message goes to stderr in every mode. Exit code stays non-zero (callers
 * set it).
 */
export function emitErrorResult(error: unknown, args: { json?: boolean }): void {
  log.error(toErrorMessage(error))
  const jsonMode = args.json || !process.stdout.isTTY
  if (!jsonMode) return
  const payload = { error: { code: errorCode(error), message: toErrorMessage(error) } }
  writeResult(JSON.stringify(payload, null, 2) + '\n')
}

/** ToolError/FileIOError carry codes; Node errors expose e.g. ENOENT. */
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
    if (error.name === 'ConfigError') return 'CONFIG_ERROR'
  }
  return 'UNKNOWN_ERROR'
}

/** Provider selection flags shared by the translate commands. */
export const providerArgs = {
  provider: { type: 'string' as const, description: 'LLM provider: "openai", "anthropic", or "google". Required for automatic translation.', valueHint: 'openai|anthropic|google' },
  model: { type: 'string' as const, description: 'Model name (required when --provider is set)' },
  apiKey: { type: 'string' as const, description: 'API key (falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env).' },
  baseUrl: { type: 'string' as const, description: `Provider base URL for gateways, self-hosted models and proxies speaking the provider's protocol. Falls back to ${BASE_URL_ENV}, then providerBaseUrl in .i18n-mcp.json. Not supported by "google".` },
}

/**
 * Build a TranslateFn from the provider flags, or undefined when no provider
 * was given (agent mode). The base URL resolves flag > env > project config;
 * the config file is only read when neither of the first two is set, so a
 * fully-flagged invocation never depends on config discovery.
 */
export async function resolveProviderTranslateFn(args: {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  projectDir?: string
}): Promise<TranslateFn | undefined> {
  if (!args.provider) return undefined
  if (!args.model) {
    throw new Error('--model is required when --provider is set')
  }

  let baseUrl = resolveProviderBaseUrl({ flag: args.baseUrl, env: process.env[BASE_URL_ENV] })
  if (!baseUrl) {
    const projectConfig = await loadProjectConfig(args.projectDir ?? process.cwd())
    baseUrl = resolveProviderBaseUrl({ config: projectConfig?.providerBaseUrl })
  }
  if (baseUrl) log.debug(`Provider base URL: ${redactBaseUrl(baseUrl)}`)

  return createTranslateFn({
    provider: args.provider as LlmProvider,
    model: args.model,
    apiKey: args.apiKey,
    baseUrl,
  })
}

/**
 * Strip anything secret-shaped from a base URL before it reaches a log.
 * Gateways are routinely addressed as https://user:pass@host or with the key
 * in a query parameter, so keep only origin and path.
 */
export function redactBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '<unparseable base URL>'
  }
  const credentials = url.username || url.password ? '<redacted>@' : ''
  const query = url.search || url.hash ? ' (query redacted)' : ''
  return `${url.protocol}//${credentials}${url.host}${url.pathname}${query}`
}

/** Split a comma-separated string into a trimmed array, or return undefined */
export function splitList(val: string | undefined): string[] | undefined {
  if (!val) return undefined
  return val.split(',').map(s => s.trim()).filter(Boolean)
}

/** Parse a JSON string with a user-friendly error */
export function parseJsonArg<T = Record<string, Record<string, string>>>(
  value: string,
  argName: string,
): T {
  try {
    return JSON.parse(value) as T
  } catch (err) {
    const detail = err instanceof SyntaxError ? err.message : String(err)
    throw new Error(`Invalid JSON in --${argName}: ${detail}`)
  }
}
