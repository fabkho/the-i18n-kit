import { FileIOError } from '../utils/errors'
import { toErrorMessage } from '../utils/errors'
import { sortKeysDeep, orderKeysPreserving } from './key-operations'
import { clearFileCacheEntry, readLocaleFileWithMeta } from './json-reader'
import { atomicWrite } from './atomic-write'

export interface WriteOptions {
  indent?: string
  trailingNewline?: boolean
  sortKeys?: boolean
}

export async function writeLocaleFile(
  filePath: string,
  data: Record<string, unknown>,
  options: WriteOptions = {},
): Promise<void> {
  const {
    indent = '\t',
    trailingNewline = true,
    sortKeys = true,
  } = options

  try {
    const outputData = sortKeys ? sortKeysDeep(data) : data
    let content = JSON.stringify(outputData, null, indent)
    if (trailingNewline) {
      content += '\n'
    }

    await atomicWrite(filePath, content, () => clearFileCacheEntry(filePath))
  } catch (error) {
    if (error instanceof FileIOError) throw error
    throw new FileIOError(
      `Failed to write file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}

export async function writeReportFile(
  filePath: string,
  output: object,
  meta: { tool: string; args: Record<string, unknown> },
): Promise<void> {
  const report = {
    generatedAt: new Date().toISOString(),
    tool: meta.tool,
    args: meta.args,
    ...output,
  }

  const content = JSON.stringify(report, null, 2) + '\n'

  try {
    await atomicWrite(filePath, content)
  } catch (error) {
    if (error instanceof FileIOError) throw error
    throw new FileIOError(
      `Failed to write report file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}

/**
 * Write a GitLab Code Quality report: a bare JSON array — the format is
 * externally specified, so no metadata wrapper (unlike writeReportFile).
 */
export async function writeCodequalityFile(
  filePath: string,
  issues: unknown[],
): Promise<void> {
  const content = JSON.stringify(issues, null, 2) + '\n'

  try {
    await atomicWrite(filePath, content)
  } catch (error) {
    if (error instanceof FileIOError) throw error
    throw new FileIOError(
      `Failed to write codequality file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}

/**
 * Read, mutate, and write back a single JSON locale file while preserving its
 * existing formatting:
 *
 * - Indentation and trailing newline are detected from the file on disk
 *   (readLocaleFileWithMeta bypasses the mtime read cache by design — it needs
 *   the raw content; the subsequent write clears the cache entry, so cached
 *   readers stay consistent).
 * - Existing keys keep their on-disk order; keys added by the mutation are
 *   inserted in sorted position among their siblings.
 */
export async function mutateLocaleFile(
  filePath: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<void> {
  const { data, indent, trailingNewline } = await readLocaleFileWithMeta(filePath)
  // Snapshot the on-disk key order before the mutation runs so existing keys
  // keep their positions even if the mutation rebuilds objects.
  const reference = structuredClone(data)
  mutate(data)
  const ordered = orderKeysPreserving(data, reference)
  await writeLocaleFile(filePath, ordered, { indent, trailingNewline, sortKeys: false })
}
