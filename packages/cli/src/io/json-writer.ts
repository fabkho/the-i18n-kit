import { FileIOError } from '../utils/errors'
import { toErrorMessage } from '../utils/errors'
import { sortKeysDeep } from './key-operations'
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
  output: Record<string, unknown>,
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

export async function mutateLocaleFile(
  filePath: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<void> {
  const { data, indent, trailingNewline } = await readLocaleFileWithMeta(filePath)
  mutate(data)
  await writeLocaleFile(filePath, data, { indent, trailingNewline })
}
