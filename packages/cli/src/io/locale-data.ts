import { join, extname } from 'node:path'
import { readdir, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readLocale, writeLocale, mutateLocale } from './locale-io'
import { clearFileCacheEntry } from './json-reader'
import { clearPhpFileCacheEntry } from './php-reader'
import type { I18nConfig, LocaleDefinition } from '../config/types'
import { log } from '../utils/logger'
import { FileIOError } from '../utils/errors'

/**
 * A single locale file entry with its path and optional namespace.
 * - Nuxt: one entry with namespace = null (flat file)
 * - Laravel / Next.js / React: one entry per file, namespace = filename without extension
 */
export interface LocaleEntry {
  /** Absolute path to the locale file */
  path: string
  /** Namespace for this entry (e.g., 'auth', 'validation'). null for flat file formats. */
  namespace: string | null
}

/**
 * Resolve all locale file entries for a given locale in a layer.
 *
 * - Nuxt (json): Returns a single entry `[{path: ".../en-US.json", namespace: null}]`
 * - Laravel (php-array): Scans `{langDir}/{localeCode}/*.php` and returns one entry per file
 * - Next.js / React (json): Scans `{localeDir}/{localeCode}/*.json` and returns one entry per file
 *   e.g., `[{path: ".../en/common.json", namespace: "common"}, ...]`
 *
 * Returns an empty array if the locale directory doesn't exist (e.g., new locale).
 */
export async function resolveLocaleEntries(
  config: I18nConfig,
  layer: string,
  locale: LocaleDefinition,
): Promise<LocaleEntry[]> {
  const localeDir = resolveLayerDir(config, layer)
  if (!localeDir) return []

  if (config.localeFileFormat === 'php-array') {
    return resolvePhpEntries(localeDir, locale.code)
  }

  // Namespaced JSON (Next.js/React: messages/en/common.json)
  const jsonEntries = await resolveJsonEntries(localeDir, locale.code)
  if (jsonEntries.length > 0) return jsonEntries

  // Flat JSON (Nuxt: i18n/en-US.json)
  if (!locale.file) {
    // A flat-layout locale without a `file` cannot be resolved at all — reads
    // would silently report {} and writes would vanish. If a matching flat
    // file exists on disk, this is a misconfiguration (e.g. an adapter that
    // forgot to set `file`): fail loudly instead of silently returning [].
    const flatCandidate = join(localeDir, `${locale.code}.json`)
    if (existsSync(flatCandidate)) {
      log.warn(
        `Locale '${locale.code}' (layer '${layer}') uses a flat JSON layout but has no 'file' set — `
        + `${flatCandidate} exists yet cannot be resolved. Reads will return no keys and writes will be no-ops. `
        + `Set 'file' on the locale definition (e.g. '${locale.code}.json').`,
      )
    }
    return []
  }
  return [{ path: join(localeDir, locale.file), namespace: null }]
}

/**
 * Read all locale data for a locale in a layer, merged into a single object.
 *
 * - Nuxt: Returns the JSON file contents as-is
 * - Laravel / Next.js / React: Reads each namespace file and mounts under its namespace key
 *   e.g., `{ auth: { failed: "..." }, common: { welcome: "Hello" } }`
 *
 * Missing files are treated as empty objects (no error thrown).
 */
export async function readLocaleData(
  config: I18nConfig,
  layer: string,
  locale: LocaleDefinition,
): Promise<Record<string, unknown>> {
  const entries = await resolveLocaleEntries(config, layer, locale)
  if (entries.length === 0) return {}

  const merged: Record<string, unknown> = {}

  for (const entry of entries) {
    let data: Record<string, unknown>
    try {
      data = await readLocale(entry.path)
    }
    catch (err) {
      if (err instanceof FileIOError && err.code === 'FILE_NOT_FOUND') {
        data = {}
      }
      else {
        throw err
      }
    }

    if (entry.namespace === null) {
      Object.assign(merged, data)
    }
    else {
      merged[entry.namespace] = data
    }
  }

  return merged
}

/**
 * Read, mutate, and write back locale data for a locale in a layer.
 *
 * The mutation function receives the merged locale object (same shape as readLocaleData)
 * and may modify it in-place. After mutation:
 *
 * - Nuxt: Writes the entire object back to the single JSON file
 * - Laravel / Next.js / React: Splits by top-level namespace keys and writes each to its file.
 *   New namespaces create new files. Empty namespaces delete the content (write empty object).
 *
 * Returns the set of file paths that were written.
 */
export async function mutateLocaleData(
  config: I18nConfig,
  layer: string,
  locale: LocaleDefinition,
  mutate: (data: Record<string, unknown>) => void,
): Promise<Set<string>> {
  const data = await readLocaleData(config, layer, locale)

  const filesWritten = new Set<string>()

  const entries = await resolveLocaleEntries(config, layer, locale)
  const isNamespaced = config.localeFileFormat === 'php-array'
    || entries.some(e => e.namespace !== null)
    || await hasNamespacedJsonLayout(config, layer)

  if (isNamespaced) {
    // Per-namespace write (PHP arrays or namespaced JSON)
    const localeDir = resolveLayerDir(config, layer)
    if (!localeDir) return filesWritten

    const localePath = join(localeDir, locale.code)
    const fileExt = entries.length > 0
      ? extname(entries[0].path) // '.php' or '.json'
      : config.localeFileFormat === 'php-array' ? '.php' : '.json'

    const preSnapshots = new Map<string, string>()
    for (const [ns, nsData] of Object.entries(data)) {
      preSnapshots.set(ns, JSON.stringify(nsData))
    }
    const mergedSnapshot = JSON.stringify(data)

    mutate(data)

    if (JSON.stringify(data) === mergedSnapshot) {
      return filesWritten
    }

    if (!existsSync(localePath)) {
      await mkdir(localePath, { recursive: true })
    }

    await writeChangedNamespaces(data, preSnapshots, localePath, fileExt, locale.code, filesWritten)
    await deleteRemovedNamespaceFiles(data, preSnapshots, localePath, fileExt, locale.code)
  }
  else {
    // Flat file write (Nuxt-style single JSON file)
    const snapshot = JSON.stringify(data)
    mutate(data)

    if (JSON.stringify(data) === snapshot) {
      return filesWritten
    }

    if (entries.length === 0) return filesWritten
    const filePath = entries[0].path
    await writeLocaleEntryFile(filePath, data)
    filesWritten.add(filePath)
  }

  return filesWritten
}

// ─── Internal helpers ───────────────────────────────────────────

/** Write every namespace whose content changed relative to its pre-mutation snapshot. */
async function writeChangedNamespaces(
  data: Record<string, unknown>,
  preSnapshots: Map<string, string>,
  localePath: string,
  fileExt: string,
  localeCode: string,
  filesWritten: Set<string>,
): Promise<void> {
  for (const [namespace, nsData] of Object.entries(data)) {
    if (typeof nsData !== 'object' || nsData === null) {
      log.warn(`Skipping non-object namespace '${namespace}' for locale '${localeCode}'`)
      continue
    }
    if (JSON.stringify(nsData) !== preSnapshots.get(namespace)) {
      const filePath = join(localePath, `${namespace}${fileExt}`)
      await writeLocaleEntryFile(filePath, nsData as Record<string, unknown>)
      filesWritten.add(filePath)
    }
  }
}

/**
 * Delete only the namespace files this mutation explicitly removed (top-level
 * keys present before the mutation and absent after) — never a
 * whole-directory reconciliation. Narrowing deletion to this mutation's own
 * removals also defuses the concurrency hazard: translateMissing runs one
 * mutation per locale in a Promise.all, and a directory-wide sweep could race
 * concurrent mutations on shared/aliased namespace dirs and delete files
 * another locale's mutation was about to write.
 */
async function deleteRemovedNamespaceFiles(
  data: Record<string, unknown>,
  preSnapshots: Map<string, string>,
  localePath: string,
  fileExt: string,
  localeCode: string,
): Promise<void> {
  for (const namespace of preSnapshots.keys()) {
    if (namespace in data) continue
    const filePath = join(localePath, `${namespace}${fileExt}`)
    if (!existsSync(filePath)) continue
    log.warn(`Deleting namespace file '${filePath}': namespace '${namespace}' was removed from locale '${localeCode}'`)
    try {
      await unlink(filePath)
    }
    catch (err) {
      throw new FileIOError(
        `Failed to delete removed namespace file: ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
      )
    }
    if (fileExt === '.php') clearPhpFileCacheEntry(filePath)
    else clearFileCacheEntry(filePath)
  }
}

/**
 * Write mutated locale data to a single file.
 *
 * Existing files go through the format-preserving mutate path
 * (mutateLocaleFile / mutatePhpLocaleFile): indentation, trailing newline and
 * PHP quote style are detected from the file on disk, existing keys keep
 * their on-disk order, and new keys are inserted in sorted position among
 * their siblings. The mutate path re-reads the file with metadata (bypassing
 * the mtime read cache by design) and the write clears the cache entry, so
 * cached readers stay consistent.
 *
 * New files are written with the writer defaults (sorted keys, standard
 * indentation).
 */
async function writeLocaleEntryFile(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!existsSync(filePath)) {
    await writeLocale(filePath, data)
    return
  }

  await mutateLocale(filePath, (fileData) => {
    for (const key of Object.keys(fileData)) {
      delete fileData[key]
    }
    Object.assign(fileData, data)
  })
}

function resolveLayerDir(config: I18nConfig, layer: string): string | null {
  const dir = config.localeDirs.find(d => d.layer === layer)
  if (!dir) return null
  if (dir.aliasOf) {
    const aliasDir = config.localeDirs.find(d => d.layer === dir.aliasOf)
    if (aliasDir) return aliasDir.path
  }
  return dir.path
}

async function hasNamespacedJsonLayout(config: I18nConfig, layer: string): Promise<boolean> {
  const localeDir = resolveLayerDir(config, layer)
  if (!localeDir) return false

  try {
    const entries = await readdir(localeDir)
    for (const entry of entries) {
      const subPath = join(localeDir, entry)
      try {
        if (existsSync(subPath)) {
          const subFiles = await readdir(subPath)
          if (subFiles.some(f => f.endsWith('.json'))) return true
        }
      }
      catch { /* skip unreadable dirs */ }
    }
  }
  catch { /* locale dir not readable */ }

  return false
}

async function resolveJsonEntries(localeDir: string, localeCode: string): Promise<LocaleEntry[]> {
  const localePath = join(localeDir, localeCode)

  if (!existsSync(localePath)) return []

  let files: string[]
  try {
    files = await readdir(localePath)
  }
  catch (err) {
    log.debug(`Failed to read locale directory ${localePath}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }

  return files
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({
      path: join(localePath, f),
      namespace: f.replace(/\.json$/, ''),
    }))
}

async function resolvePhpEntries(langDir: string, localeCode: string): Promise<LocaleEntry[]> {
  const localePath = join(langDir, localeCode)

  if (!existsSync(localePath)) return []

  let files: string[]
  try {
    files = await readdir(localePath)
  }
  catch (err) {
    log.debug(`Failed to read locale directory ${localePath}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }

  return files
    .filter(f => f.endsWith('.php'))
    .sort()
    .map(f => ({
      path: join(localePath, f),
      namespace: f.replace(/\.php$/, ''),
    }))
}
