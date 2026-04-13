import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fromString } from 'php-array-reader'
import { FileIOError } from '../utils/errors'

const fileCache = new Map<string, { data: Record<string, unknown>; mtime: number }>()

export function clearPhpFileCache(): void {
  fileCache.clear()
}

export function clearPhpFileCacheEntry(filePath: string): void {
  fileCache.delete(filePath)
}

export async function readPhpLocaleFile(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    throw new FileIOError(`File not found: ${filePath}`, filePath, 'FILE_NOT_FOUND')
  }

  try {
    const fileStat = await stat(filePath)
    const mtime = fileStat.mtimeMs

    const cached = fileCache.get(filePath)
    if (cached && cached.mtime === mtime) {
      return structuredClone(cached.data)
    }

    const content = await readFile(filePath, 'utf-8')
    const parsed = fromString(content)

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new FileIOError(
        `PHP locale file did not return an associative array: ${filePath}`,
        filePath,
      )
    }

    const data = parsed as Record<string, unknown>
    fileCache.set(filePath, { data: structuredClone(data), mtime })
    return data
  }
  catch (error) {
    if (error instanceof FileIOError) throw error
    throw new FileIOError(
      `Failed to read PHP locale file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    )
  }
}
