import { join, extname } from 'node:path'
import { readdir, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readLocale, writeLocale } from './locale-io'
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
  if (!locale.file) return []
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

    for (const [namespace, nsData] of Object.entries(data)) {
      if (typeof nsData !== 'object' || nsData === null) {
        log.warn(`Skipping non-object namespace '${namespace}' for locale '${locale.code}'`)
        continue
      }
      if (JSON.stringify(nsData) !== preSnapshots.get(namespace)) {
        const filePath = join(localePath, `${namespace}${fileExt}`)
        await writeLocale(filePath, nsData as Record<string, unknown>)
        filesWritten.add(filePath)
      }
    }

    const expectedFiles = new Set(
      Object.keys(data)
        .filter(ns => typeof data[ns] === 'object' && data[ns] !== null)
        .map(ns => `${ns}${fileExt}`),
    )
    try {
      const existingFiles = await readdir(localePath)
      for (const file of existingFiles) {
        if (file.endsWith(fileExt) && !expectedFiles.has(file)) {
          await unlink(join(localePath, file))
        }
      }
    }
    catch {}
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
    await writeLocale(filePath, data)
    filesWritten.add(filePath)
  }

  return filesWritten
}

// ─── Internal helpers ───────────────────────────────────────────

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
