import { extname } from 'node:path'
import { readLocaleFile } from './json-reader'
import { writeLocaleFile, mutateLocaleFile } from './json-writer'
import { readPhpLocaleFile } from './php-reader'
import { writePhpLocaleFile, mutatePhpLocaleFile } from './php-writer'
import { FileIOError } from '../utils/errors'

export async function readLocale(filePath: string): Promise<Record<string, unknown>> {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return readLocaleFile(filePath)
    case '.php':
      return readPhpLocaleFile(filePath)
    default:
      throw new FileIOError(`Unsupported locale file format: ${ext}`, filePath)
  }
}

export async function writeLocale(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return writeLocaleFile(filePath, data)
    case '.php':
      return writePhpLocaleFile(filePath, data)
    default:
      throw new FileIOError(`Unsupported locale file format: ${ext}`, filePath)
  }
}

export async function mutateLocale(
  filePath: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<void> {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.json':
      return mutateLocaleFile(filePath, mutate)
    case '.php':
      return mutatePhpLocaleFile(filePath, mutate)
    default:
      throw new FileIOError(`Unsupported locale file format: ${ext}`, filePath)
  }
}
