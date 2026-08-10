import { defineCommand } from 'citty'
import type { CommandDef } from 'citty'
import { log } from '../utils/logger.js'
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
      const result = await opts.run(args)
      outputResult(result, args)
      if (isTotalFailure(result) || opts.failWhen?.(result)) {
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

export const sharedArgs = {
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
export function outputResult(data: unknown, args: { json?: boolean }): void {
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
