import { log } from '../utils/logger.js'

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

/** Output result — JSON for piped/--json, pretty-printed for TTY */
export function outputResult(data: unknown, args: { json?: boolean }): void {
  // When result has reportFile key, format it nicely
  if (
    data !== null &&
    typeof data === 'object' &&
    'reportFile' in (data as Record<string, unknown>)
  ) {
    const { reportFile, ...rest } = data as Record<string, unknown>
    const summaryJson = JSON.stringify(rest, null, 2)
    if (args.json || !process.stdout.isTTY) {
      process.stdout.write(`Wrote report to: ${reportFile}\n${summaryJson}\n`)
    } else {
      log.info(`Wrote report to: ${reportFile}\n${summaryJson}`)
    }
    return
  }
  const json = JSON.stringify(data, null, 2)
  if (args.json || !process.stdout.isTTY) {
    process.stdout.write(json + '\n')
  } else {
    log.info(json)
  }
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
