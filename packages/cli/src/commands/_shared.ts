import { defineCommand } from 'citty'
import type { CommandDef } from 'citty'
import { log } from '../utils/logger.js'
import { toErrorMessage } from '../utils/errors.js'
import { writeResult } from '../utils/stdout-guard.js'

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
