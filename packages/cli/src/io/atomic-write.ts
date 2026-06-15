import { writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Atomically write content to a file.
 * Writes to a temp file first, then renames to the target path.
 * Cleans up the temp file on failure.
 *
 * @param filePath - Target file path
 * @param content - String content to write
 * @param onSuccess - Optional callback after successful rename (e.g., to clear a cache entry)
 */
export async function atomicWrite(
  filePath: string,
  content: string,
  onSuccess?: () => void,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = join(dirname(filePath), `.${randomUUID()}.tmp`)

  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, filePath)
    onSuccess?.()
  } catch (error) {
    try {
      await unlink(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}
