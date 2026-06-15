import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { FileIOError } from '../utils/errors'
import { toErrorMessage } from '../utils/errors'

/**
 * Creates an mtime-based file read cache.
 * Files are re-read only when their modification timestamp changes.
 * Cached data is cloned via structuredClone to prevent mutation.
 *
 * @param parser - Function that parses raw file content into the desired type
 * @param label - Human-readable label for error messages (e.g., 'JSON', 'PHP')
 * @param validate - Optional post-parse validation that throws FileIOError on failure
 */
export function createReadCache<T>(
  parser: (content: string) => T,
  label: string,
  validate?: (parsed: T, filePath: string) => void,
) {
  const cache = new Map<string, { data: T; mtime: number }>()

  async function read(filePath: string): Promise<T> {
    if (!existsSync(filePath)) {
      throw new FileIOError(`File not found: ${filePath}`, filePath, 'FILE_NOT_FOUND')
    }

    try {
      const fileStat = await stat(filePath)
      const mtime = fileStat.mtimeMs

      const cached = cache.get(filePath)
      if (cached && cached.mtime === mtime) {
        return structuredClone(cached.data)
      }

      const content = await readFile(filePath, 'utf-8')
      const parsed = parser(content)

      validate?.(parsed, filePath)

      cache.set(filePath, { data: structuredClone(parsed), mtime })
      return parsed
    } catch (error) {
      if (error instanceof FileIOError) throw error
      throw new FileIOError(
        `Failed to read ${label} file: ${filePath}: ${toErrorMessage(error)}`,
        filePath,
      )
    }
  }

  function clear(): void {
    cache.clear()
  }

  function clearEntry(filePath: string): void {
    cache.delete(filePath)
  }

  return { read, clear, clearEntry }
}
