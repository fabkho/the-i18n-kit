import { stringify } from 'yaml'
import { FileIOError, toErrorMessage } from '../utils/errors'
import { sortKeysDeep, orderKeysPreserving } from './key-operations'
import { clearYamlFileCacheEntry, readYamlLocaleFile } from './yaml-reader'
import { atomicWrite } from './atomic-write'

export interface YamlWriteOptions {
  sortKeys?: boolean
}

/**
 * Fixed rather than detected from the file being written: YAML has one legal
 * indent character, and `lineWidth: 0` keeps long UI strings on a single line.
 * Folded ones re-read as the same string, but every wrap point moves as soon
 * as a word changes, which turns a one-word edit into a multi-line diff.
 */
const STRINGIFY_OPTIONS = { indent: 2, lineWidth: 0 } as const

/**
 * Comments in an existing file do not survive a write: the file is
 * re-serialized from the parsed values, not patched into the document tree
 * that carries them. Keep notes for translators in the kit config
 * (`localeNotes`) rather than in the locale files it rewrites.
 */
export async function writeYamlLocaleFile(
  filePath: string,
  data: Record<string, unknown>,
  options: YamlWriteOptions = {},
): Promise<void> {
  const { sortKeys = true } = options

  try {
    const outputData = sortKeys ? sortKeysDeep(data) : data
    // stringify always terminates with a newline.
    const content = stringify(outputData, STRINGIFY_OPTIONS)

    await atomicWrite(filePath, content, () => clearYamlFileCacheEntry(filePath))
  }
  catch (error) {
    if (error instanceof FileIOError) throw error
    throw new FileIOError(
      `Failed to write YAML locale file: ${filePath}: ${toErrorMessage(error)}`,
      filePath,
    )
  }
}

/**
 * Read, mutate and write back a single YAML locale file, preserving key order:
 * existing keys keep their on-disk order and keys added by the mutation are
 * inserted in sorted position among their siblings.
 */
export async function mutateYamlLocaleFile(
  filePath: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<void> {
  const data = await readYamlLocaleFile(filePath)
  // Snapshot the on-disk key order before the mutation runs.
  const reference = structuredClone(data)
  mutate(data)
  const ordered = orderKeysPreserving(data, reference)
  await writeYamlLocaleFile(filePath, ordered, { sortKeys: false })
}
