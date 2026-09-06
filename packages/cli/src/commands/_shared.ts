import { defineCommand } from 'citty'
import type { CommandDef } from 'citty'
import { log } from '../utils/logger.js'
import { toErrorMessage } from '../utils/errors.js'
import { writeResult } from '../utils/stdout-guard.js'
import { createTranslateFn, resolveProviderBaseUrl, BASE_URL_ENV } from '../llm/providers.js'
import type { LlmProvider } from '../llm/providers.js'
import type { TranslateFn } from '../core/types.js'
import { loadProjectConfig } from '../config/project-config.js'
import type {
  AnyOperationDescriptor,
  FlaggedGateSpec,
  GateSpec,
  ParamSpec,
  Params,
} from '../surface/types.js'

// Declared with the descriptors, since a gate is something an operation
// declares; re-exported here because this is where they are evaluated and
// where the reference generator reads the exit codes from.
export type { GateSpec, FlaggedGateSpec, AlwaysOnGateSpec } from '../surface/types.js'

/**
 * Factory for commands that call an operation and output its result.
 *
 * Reached through `commandFromDescriptor`, which is the only production caller:
 * it stays a separate function because output handling, gate evaluation and
 * exit codes are worth testing against a fixed result rather than against a
 * project on disk.
 */
export function createCommand(opts: {
  name: string
  description: string
  args?: Record<string, unknown>
  /**
   * CI gates this command evaluates. The factory reads the requesting flag off
   * args and evaluates every gate uniformly, so no command grows bespoke exit
   * logic. Declaring a flagged gate does not add its flag — pair each spec
   * with an entry in `args`. A spec without a flag is always evaluated.
   */
  gates?: GateSpec[]
  /**
   * Receives citty's parsed args. `any` is deliberate: the `args` above are
   * built at runtime from a descriptor's parameters and citty does not thread
   * that type through to the handler. The typed view of these arguments is the
   * descriptor's own `run`, which `commandFromDescriptor` calls with values
   * already coerced to the declared types.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  run: (args: any) => Promise<unknown>
}): CommandDef {
  // Retained on the definition, not only consumed here: the generated CLI
  // reference has to state which commands fail a build on findings, and a gate
  // with no flag leaves no trace in the arg descriptions to infer it from.
  return withGates(defineCommand({
    meta: { name: opts.name, description: opts.description },
    args: { ...sharedArgs, ...(opts.args ?? {}) },
    async run({ args }) {
      try {
        const result = await opts.run(args)
        const decision = resolveExitCode(result, requestedGates(opts.gates ?? [], args), isTotalFailure(result))
        outputResult(withGateReport(result, decision.tripped), args)
        // Assign only on a non-zero decision: a clean run must leave the exit
        // code exactly as it found it, as it did before gates existed.
        if (decision.code !== EXIT_SUCCESS) process.exitCode = decision.code
      } catch (error) {
        emitErrorResult(error, args)
        process.exitCode = EXIT_RUN_FAILED
      }
    },
  }) as CommandDef, opts.gates ?? [])
}

/**
 * A command definition carrying the gates its factory evaluates. Read
 * structurally by the reference generator rather than by importing this type,
 * which would make the docs build depend on the CLI's internals.
 */
interface GatedCommandDef extends CommandDef {
  gates: GateSpec[]
}

function withGates(def: CommandDef, gates: GateSpec[]): GatedCommandDef {
  return Object.assign(def, { gates })
}

/** The run succeeded and no gate tripped. */
export const EXIT_SUCCESS = 0
/** The run itself failed — a bad API key, an unreadable project, a total translate failure. */
export const EXIT_RUN_FAILED = 1
/** The run succeeded but a requested gate tripped — findings exist, the tool worked. */
export const EXIT_GATE_TRIPPED = 2

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
    const resolved = spec.flag === undefined
      ? { name: spec.name, threshold: spec.threshold }
      : { name: kebabCase(spec.flag), threshold: thresholdFromFlag(spec, args) }
    if (resolved.threshold === undefined || !Number.isFinite(resolved.threshold)) continue
    requested.push({
      name: resolved.name,
      counter: spec.counter,
      direction: spec.direction ?? 'above',
      threshold: resolved.threshold,
    })
  }
  return requested
}

/** The gate's threshold, or undefined when this invocation did not ask for it. */
function thresholdFromFlag(spec: FlaggedGateSpec, args: Record<string, unknown>): number | undefined {
  const raw = args[spec.flag]
  if (raw === undefined || raw === null || raw === false || raw === '') return undefined
  return spec.threshold ?? Number(raw)
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

/**
 * The citty command for one descriptor: its flags, its gates, and a run that
 * hands the operation arguments of the types the descriptor declared.
 *
 * Everything a command needs is read off the descriptor, so a command is not a
 * file anyone writes — which is what keeps it from drifting from the tool that
 * runs the same operation.
 */
export function commandFromDescriptor(descriptor: AnyOperationDescriptor): CommandDef {
  const cli = descriptor.cli
  if (cli === null) {
    throw new Error(`Operation "${descriptor.id}" declares no CLI command.`)
  }

  return createCommand({
    name: cli.name,
    description: descriptor.description,
    args: cliArgs(descriptor.params),
    gates: descriptor.gates,
    run: async args => descriptor.run(operationArgs(descriptor.params, args), {
      surface: 'cli',
      // Resolved from the provider flags rather than passed through: which
      // flags select a backend is the CLI's business, not the operation's.
      translateFn: descriptor.usesTranslateFn === true
        ? await resolveProviderTranslateFn(args)
        : undefined,
    }),
  })
}

/** The citty `args` for a descriptor's parameters, skipping the CLI-hidden ones. */
function cliArgs(params: Params): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(params)) {
    if (spec.cli?.hidden === true) continue
    args[name] = {
      // citty parses booleans and strings. A list, a number and a JSON object
      // all arrive as one string and are converted in operationArgs.
      type: spec.type === 'boolean' ? 'boolean' : 'string',
      description: flagDescription(spec),
      ...(spec.required === true ? { required: true } : {}),
      ...(spec.default === undefined ? {} : { default: spec.default }),
      ...(spec.cli?.alias === undefined ? {} : { alias: [...toArray(spec.cli.alias)] }),
      ...(spec.enum === undefined ? {} : { valueHint: spec.enum.join('|') }),
    }
  }
  return args
}

/**
 * The description a flag prints. The declared one is written for a reader of
 * either surface, so how to spell a list or an object at a shell prompt is
 * added here rather than in every spec.
 */
function flagDescription(spec: ParamSpec): string {
  if (spec.type === 'string[]') {
    return `${spec.description} Comma-separated${spec.allowAll === true ? ', or "all"' : ''}.`
  }
  if (spec.type === 'record') return `${spec.description} Pass it as JSON.`
  return spec.description
}

/**
 * citty's parsed args as the operation takes them: lists split, numbers and
 * JSON parsed, enums checked. `projectDir` comes along because every operation
 * accepts it without declaring it.
 */
function operationArgs(params: Params, args: Record<string, unknown>): Record<string, unknown> {
  const operation: Record<string, unknown> = { projectDir: args.projectDir }
  for (const [name, spec] of Object.entries(params)) {
    if (spec.cli?.hidden === true) continue
    const value = coerce(name, spec, args[name])
    if (value !== undefined) operation[name] = value
  }
  return operation
}

function coerce(name: string, spec: ParamSpec, raw: unknown): unknown {
  if (spec.type === 'boolean') return typeof raw === 'boolean' ? raw : undefined

  const value = typeof raw === 'string' ? raw : undefined

  switch (spec.type) {
    case 'number':
      return value === undefined || value === '' ? undefined : toNumber(name, spec, value)
    case 'string[]':
      return toList(name, spec, value)
    case 'record':
      return value === undefined ? undefined : parseJsonArg(value, name)
    default:
      return toEnumChecked(name, spec, value)
  }
}

function toEnumChecked(name: string, spec: ParamSpec, value: string | undefined): string | undefined {
  if (spec.enum === undefined) return value
  // An empty value is an unset flag, not a value to reject: a shell produces
  // one routinely from an unset variable.
  if (value === undefined || value === '') return undefined
  if (!spec.enum.includes(value)) {
    throw new Error(`Invalid --${name} value: "${value}". Must be one of: ${spec.enum.join(', ')}`)
  }
  return value
}

function toNumber(name: string, spec: ParamSpec, raw: string): number {
  const value = Number(raw)
  const wellFormed = Number.isFinite(value)
    && (spec.integer !== true || (Number.isInteger(value) && String(value) === raw.trim()))
    && (spec.min === undefined || value >= spec.min)
  if (!wellFormed) {
    throw new Error(`Invalid --${name}: "${raw}". Must be ${numberRequirement(spec)}`)
  }
  return value
}

function numberRequirement(spec: ParamSpec): string {
  if (spec.integer !== true) {
    return spec.min === undefined ? 'a number' : `a number of at least ${spec.min}`
  }
  if (spec.min === 1) return 'a positive integer'
  return spec.min === undefined ? 'an integer' : `an integer of at least ${spec.min}`
}

function toList(name: string, spec: ParamSpec, raw: string | undefined): string[] | 'all' | undefined {
  if (spec.allowAll === true && raw === 'all') return 'all'

  const list = splitList(raw)
  // A list flag that was passed and yielded nothing is a mistake, not a request
  // for the default — and a required list with nothing in it has no meaning.
  const empty = list === undefined || list.length === 0
  if (empty && (spec.required === true || (raw !== undefined && raw !== ''))) {
    throw new Error(`No ${name} provided. Pass a comma-separated list via --${name}.`)
  }
  return list
}

function toArray(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [value] : value
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
function splitList(val: string | undefined): string[] | undefined {
  if (!val) return undefined
  return val.split(',').map(s => s.trim()).filter(Boolean)
}

/** Parse a JSON string with a user-friendly error */
function parseJsonArg<T = Record<string, Record<string, string>>>(
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
