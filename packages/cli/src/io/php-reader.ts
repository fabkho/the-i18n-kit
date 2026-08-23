import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { FileIOError, toErrorMessage } from '../utils/errors'

/**
 * `php-array-reader` is an optional peer (#406): only Laravel projects carry
 * it. Resolved from the locale file outward, so a CLI running from the npx
 * cache finds the project's install. Unlike the scanner's parser, locale IO
 * has no fallback to degrade to — a missing install is an error naming the
 * one-line fix.
 */
const LARAVEL_INSTALL_HINT = 'Laravel projects need the PHP packages installed: npm i -D php-parser php-array-reader'

type FromString = (content: string) => unknown
// Keyed by the locale file's directory — see the scanner's parser cache: a
// long-lived server must not pin resolution (or a cached failure) to the
// first project it served.
const fromStringPromises = new Map<string, Promise<FromString | null>>()

function loadFromString(fromFile: string): Promise<FromString | null> {
  const key = dirname(fromFile)
  let promise = fromStringPromises.get(key)
  if (!promise) {
    promise = resolveFromString(fromFile)
    fromStringPromises.set(key, promise)
  }
  return promise
}

async function resolveFromString(fromFile: string): Promise<FromString | null> {
  try {
    const from = isAbsolute(fromFile) ? fromFile : join(process.cwd(), fromFile)
    return (createRequire(from)('php-array-reader') as { fromString: FromString }).fromString
  } catch { /* project has no install of its own */ }
  try {
    return (await import('php-array-reader')).fromString
  } catch {
    return null
  }
}

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
    const fromString = await loadFromString(filePath)
    if (!fromString) {
      throw new FileIOError(`Cannot read PHP locale files: php-array-reader is not installed. ${LARAVEL_INSTALL_HINT}`, filePath)
    }
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
      `Failed to read PHP locale file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}
