import { defineCommand } from 'citty'
import type { CommandDef } from 'citty'
import { log } from '../utils/logger.js'

/** Factory for commands that call an operation and output its result. */
export function createCommand(opts: {
  name: string
  description: string
  args?: Record<string, unknown>
  run: (args: any) => Promise<unknown>
}): CommandDef {
  return defineCommand({
    meta: { name: opts.name, description: opts.description },
    args: { ...sharedArgs, ...(opts.args ?? {}) },
    async run({ args }) {
      const result = await opts.run(args)
      outputResult(result, args)
    },
  }) as any
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
    process.stdout.write(JSON.stringify(rest, null, 2) + '\n')
    return
  }
  // JSON mode emits the full result (including reportFile when present) as pure JSON
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
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
