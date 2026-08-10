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
  run: (args: any) => Promise<unknown>
}): CommandDef {
  return defineCommand({
    meta: { name: opts.name, description: opts.description },
    args: { ...sharedArgs, ...(opts.args ?? {}) },
    async run({ args }) {
      try {
        const result = await opts.run(args)
        outputResult(result, args)
        if (isTotalFailure(result) || opts.failWhen?.(result)) {
          process.exitCode = 1
        }
      } catch (error) {
        emitErrorResult(error, args)
        process.exitCode = 1
      }
    },
  }) as any
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
  baseUrl: { type: 'string' as const, description: `Provider base URL for OpenAI-compatible gateways, local models and proxies. Falls back to ${BASE_URL_ENV}, then providerBaseUrl in .i18n-mcp.json. Not supported by "google".` },
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
