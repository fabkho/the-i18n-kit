import { parseAllDocuments } from 'yaml'
import { FileIOError } from '../utils/errors'
import { createReadCache } from './read-cache'

/**
 * Parse a YAML locale file into plain data.
 *
 * A locale file is one mapping, so a stream of several documents is refused by
 * name rather than silently reduced to its first one. Parse errors are
 * collected on the document rather than thrown, so the first one is raised
 * here to reach the same wrapping the JSON reader gets.
 */
function parseYaml(content: string): Record<string, unknown> {
  const documents = parseAllDocuments(content)

  if (documents.length > 1) {
    throw new SyntaxError(
      `YAML file holds ${documents.length} documents (separated by '---') — a locale file must hold exactly one`,
    )
  }

  const document = documents[0]
  // An empty file parses to no document at all; the validation below rejects
  // it the way an empty .json file is rejected.
  if (!document) return null as unknown as Record<string, unknown>

  const error = document.errors[0]
  if (error) throw new SyntaxError(error.message)

  return document.toJS() as Record<string, unknown>
}

const {
  read: readYamlLocaleFile,
  clear: clearYamlFileCache,
  clearEntry: clearYamlFileCacheEntry,
} = createReadCache<Record<string, unknown>>(
  parseYaml,
  'YAML',
  (parsed, filePath) => {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FileIOError(`YAML file must contain a mapping: ${filePath}`, filePath, 'INVALID_YAML')
    }
  },
)

export { readYamlLocaleFile, clearYamlFileCache, clearYamlFileCacheEntry }
