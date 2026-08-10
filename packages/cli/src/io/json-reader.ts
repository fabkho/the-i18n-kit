import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { FileIOError } from '../utils/errors'
import { toErrorMessage } from '../utils/errors'
import { createReadCache } from './read-cache'

const { read: readLocaleFile, clear: clearFileCache, clearEntry: clearFileCacheEntry } = createReadCache<Record<string, unknown>>(
  (content) => {
    try {
      return JSON.parse(content) as Record<string, unknown>
    } catch {
      throw new SyntaxError('Invalid JSON')
    }
  },
  'JSON',
  (parsed, filePath) => {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FileIOError(`JSON file must contain an object: ${filePath}`, filePath, 'INVALID_JSON')
    }
  },
)

export { readLocaleFile, clearFileCache, clearFileCacheEntry }

/**
 * Detect the indentation style used in a JSON file.
 * Scans the first few indented lines to find the smallest indent unit.
 * Returns the indent string (e.g., '\t', '  ', '    ').
 */
export function detectIndentation(content: string): string {
  const lines = content.split('\n', 10)
  let minSpaces = Infinity
  let usesTabs = false

  for (const line of lines) {
    const indent = line.match(/^(\s+)\S/)?.[1]
    if (!indent) continue

    if (indent.includes('\t')) {
      usesTabs = true
      break
    }

    if (indent.length < minSpaces) {
      minSpaces = indent.length
    }
  }

  if (usesTabs) return '\t'
  if (minSpaces === Infinity) return '\t' // no indentation found
  return ' '.repeat(minSpaces)
}

/**
 * Read a locale file and also return the raw content for format detection.
 * This function does NOT use the cache — it always reads fresh data from disk,
 * as it returns raw content and indent info needed for writes.
 */
export async function readLocaleFileWithMeta(filePath: string): Promise<{
  data: Record<string, unknown>
  rawContent: string
  indent: string
  trailingNewline: boolean
}> {
  if (!existsSync(filePath)) {
    throw new FileIOError(`File not found: ${filePath}`, filePath, 'FILE_NOT_FOUND')
  }

  try {
    const rawContent = await readFile(filePath, 'utf-8')
    const data = JSON.parse(rawContent) as Record<string, unknown>
    const indent = detectIndentation(rawContent)
    const trailingNewline = rawContent.endsWith('\n')

    return { data, rawContent, indent, trailingNewline }
  } catch (error) {
    if (error instanceof FileIOError) throw error
    if (error instanceof SyntaxError) {
      throw new FileIOError(`Invalid JSON in file: ${filePath}`, filePath, 'INVALID_JSON')
    }
    throw new FileIOError(
      `Failed to read file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}
