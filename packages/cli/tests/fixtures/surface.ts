/**
 * Run an operation the way a surface runs it: the descriptor's own `run`,
 * followed by the report diversion that the CLI command factory and the MCP
 * tool registrar both apply.
 *
 * Tests of the diversion go through this rather than through a core function,
 * because a core operation no longer knows anything about report files.
 */

import type { OperationContext } from '../../src/surface/types.js'

export async function runOperation<T = unknown>(
  id: string,
  args: Record<string, unknown> = {},
  ctx: Partial<OperationContext> = {},
): Promise<T> {
  const { descriptors } = await import('../../src/surface/descriptors.js')
  const { divertToReport } = await import('../../src/surface/report.js')

  const descriptor = descriptors.find(candidate => candidate.id === id)
  if (descriptor === undefined) throw new Error(`No operation descriptor with id "${id}"`)

  const result = await descriptor.run(args, { surface: 'cli', ...ctx })
  return await divertToReport(result, descriptor, args) as T
}
