import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { FileIOError } from '../utils/errors.js'

/**
 * Read and parse a JSON locale file.
 */
export async function readLocaleFile(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    throw new FileIOError(`File not found: ${filePath}`, filePath)
  }

  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new FileIOError(`Invalid JSON in file: ${filePath}`, filePath)
    }
    throw new FileIOError(
      `Failed to read file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    )
  }
}

/**
 * Detect the indentation style used in a JSON file.
 * Returns the indent string (e.g., '\t', '  ', '    ').
 */
export function detectIndentation(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    // Find the first indented line
    const match = line.match(/^(\s+)/)
    if (match) {
      const indent = match[1]
      // If it starts with tab, it's tabs
      if (indent.startsWith('\t')) {
        return '\t'
      }
      // Otherwise return the spaces (could be 2 or 4)
      return indent
    }
  }
  // Default to tab
  return '\t'
}

/**
 * Read a locale file and also return the raw content for format detection.
 */
export async function readLocaleFileWithMeta(filePath: string): Promise<{
  data: Record<string, unknown>
  rawContent: string
  indent: string
  trailingNewline: boolean
}> {
  if (!existsSync(filePath)) {
    throw new FileIOError(`File not found: ${filePath}`, filePath)
  }

  try {
    const rawContent = await readFile(filePath, 'utf-8')
    const data = JSON.parse(rawContent) as Record<string, unknown>
    const indent = detectIndentation(rawContent)
    const trailingNewline = rawContent.endsWith('\n')

    return { data, rawContent, indent, trailingNewline }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new FileIOError(`Invalid JSON in file: ${filePath}`, filePath)
    }
    throw new FileIOError(
      `Failed to read file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    )
  }
}
