import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../../config/types'
import { loadProjectConfig } from '../../config/project-config'
import { applyLocaleOverride } from '../../config/locale-override'
import { log } from '../../utils/logger'
import { ConfigError } from '../../utils/errors'

export class LaravelAdapter implements FrameworkAdapter {
  readonly name = 'laravel'
  readonly label = 'Laravel'
  readonly localeFileFormat: LocaleFileFormat = 'php-array'

  async detect(projectDir: string): Promise<number> {
    let score = 0

    if (existsSync(join(projectDir, 'artisan'))) {
      score += 2
    }

    try {
      const raw = await readFile(join(projectDir, 'composer.json'), 'utf-8')
      const composer = JSON.parse(raw) as Record<string, unknown>
      const require = composer.require as Record<string, unknown> | undefined
      if (require && 'laravel/framework' in require) {
        score += 2
      }
    }
    catch {
      // composer.json missing or malformed — skip
    }

    // Weak signal: lang/ with PHP subdirectories or JSON files
    const langDir = findLangDir(projectDir)
    if (langDir) {
      const hasLocaleFiles = await hasLocaleContent(langDir)
      if (hasLocaleFiles) score += 1
    }

    return score
  }

  async resolve(projectDir: string): Promise<I18nConfig> {
    const projectConfig = await loadProjectConfig(projectDir)

    const langDir = findLangDir(projectDir)
    if (!langDir) {
      throw new ConfigError(
        `No lang/ or resources/lang/ directory found in ${projectDir}. `
        + 'Make sure your Laravel project has a locale directory.',
      )
    }

    // Determine file format: honor override, auto-detect, or default
    const format = resolveFormat(langDir, projectConfig?.localeFileFormat)

    // Discover locale codes based on format
    const localeCodes = await discoverLocaleCodes(langDir, format)
    if (localeCodes.length === 0) {
      throw new ConfigError(
        getFormatError(langDir, format),
      )
    }

    const { defaultLocale, fallbackLocale, configLocales } = await extractLocaleConfig(projectDir)

    const allCodes = mergeLocaleCodes(localeCodes, configLocales)

    const locales: LocaleDefinition[] = applyLocaleOverride(
      allCodes.map(code => ({
        code,
        language: code,
        ...(format === 'json' ? { file: `${code}.json` } : {}),
      })),
      projectConfig?.locales,
    )

    const localeDirs: LocaleDir[] = [{
      path: langDir,
      layer: 'root',
      layerRootDir: projectDir,
    }]

    log.info(
      `Discovered ${locales.length} locale(s) in ${langDir} (${format}): `
      + `${allCodes.join(', ')}`,
    )

    return {
      rootDir: projectDir,
      defaultLocale,
      fallbackLocale,
      locales,
      localeDirs,
      layerRootDirs: [projectDir],
      projectConfig: projectConfig ?? undefined,
      localeFileFormat: format,
      apps: [{ name: 'root', rootDir: projectDir, layers: ['root'] }],
    }
  }
}

// ─── Format detection ───────────────────────────────────────────

function resolveFormat(
  langDir: string,
  override?: LocaleFileFormat,
): LocaleFileFormat {
  if (override) return override

  const hasJson = existsSync(join(langDir, 'en.json'))
    || existsSync(join(langDir, 'de.json'))
    || existsSync(join(langDir, 'fr.json'))
  const hasPhp = hasPhpSubdirsSync(langDir)

  // When both exist, prefer php-array (backward compatible)
  if (hasPhp) return 'php-array'
  if (hasJson) return 'json'

  return 'php-array' // default
}

function hasPhpSubdirsSync(langDir: string): boolean {
  try {
    const entries = readdirSync(langDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'vendor') continue
      const subEntries = readdirSync(join(langDir, entry.name))
      if (subEntries.some(f => f.endsWith('.php'))) return true
    }
  }
  catch { /* can't read */ }
  return false
}

function getFormatError(langDir: string, format: LocaleFileFormat): string {
  if (format === 'json') {
    return `No JSON locale files found in ${langDir}. Expected files like lang/en.json, lang/de.json.`
  }
  return `No locale subdirectories found in ${langDir}. Expected directories like lang/en/, lang/de/.`
}

// ─── Locale discovery ───────────────────────────────────────────

async function hasLocaleContent(langDir: string): Promise<boolean> {
  // Check for JSON files (flat layout)
  const entries = await readdir(langDir).catch(() => [] as string[])
  if (entries.some(f => f.endsWith('.json'))) return true

  // Check for PHP subdirectories (namespaced layout)
  return hasPhpContent(langDir)
}

async function discoverLocaleCodes(
  langDir: string,
  format: LocaleFileFormat,
): Promise<string[]> {
  if (format === 'json') {
    return discoverJsonLocales(langDir)
  }
  return findLocaleSubdirs(langDir)
}

async function discoverJsonLocales(langDir: string): Promise<string[]> {
  const entries = await readdir(langDir).catch(() => [] as string[])
  return entries
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort()
}

async function hasPhpContent(langDir: string): Promise<boolean> {
  const subdirs = await findLocaleSubdirs(langDir)
  return subdirs.length > 0
}

/**
 * Laravel 9+ uses root-level `lang/`, older versions use `resources/lang/`.
 */
function findLangDir(projectDir: string): string | null {
  const candidates = [
    join(projectDir, 'lang'),
    join(projectDir, 'resources', 'lang'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function findLocaleSubdirs(langDir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(langDir, { withFileTypes: true })
  }
  catch {
    return []
  }

  const locales: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'vendor') continue
    const files = await readdir(join(langDir, entry.name)).catch(() => [] as string[])
    if (files.some(f => f.endsWith('.php'))) {
      locales.push(entry.name)
    }
  }

  return locales.sort()
}

// ─── Config parsing ─────────────────────────────────────────────

/**
 * Extract default and fallback locale from config/app.php.
 */
async function extractLocaleConfig(projectDir: string): Promise<{
  defaultLocale: string
  fallbackLocale: Record<string, string[]>
  configLocales: string[]
}> {
  const configPath = join(projectDir, 'config', 'app.php')

  let content: string
  try {
    content = await readFile(configPath, 'utf-8')
  }
  catch {
    log.debug('No config/app.php found, using defaults')
    return {
      defaultLocale: 'en',
      fallbackLocale: { default: ['en'] },
      configLocales: [],
    }
  }

  const defaultLocale = extractPhpConfigValue(content, 'locale') ?? 'en'
  const fallbackValue = extractPhpConfigValue(content, 'fallback_locale') ?? defaultLocale
  const configLocales = extractPhpArrayValue(content, 'locales')

  log.debug(`Extracted locale config: locale=${defaultLocale}, fallback=${fallbackValue}, config locales=${configLocales.length}`)

  return {
    defaultLocale,
    fallbackLocale: { default: [fallbackValue] },
    configLocales,
  }
}

function extractPhpConfigValue(content: string, key: string): string | null {
  const envPattern = new RegExp(
    `['"]${key}['"]\\s*=>\\s*env\\s*\\(\\s*['"][^'"]*['"]\\s*,\\s*['"]([^'"]+)['"]\\s*\\)`,
  )
  const envMatch = content.match(envPattern)
  if (envMatch) {
    return envMatch[1]
  }

  const directPattern = new RegExp(
    `['"]${key}['"]\\s*=>\\s*['"]([^'"]+)['"]`,
  )
  const directMatch = content.match(directPattern)
  if (directMatch) {
    return directMatch[1]
  }

  return null
}

function extractPhpArrayValue(content: string, key: string): string[] {
  const pattern = new RegExp(
    `['"]${key}['"]\\s*=>\\s*\\[([^\\]]*)]`,
  )
  const match = content.match(pattern)
  if (!match) return []

  const itemPattern = /['"]([^'"]+)['"]/g
  const items: string[] = []
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemPattern.exec(match[1])) !== null) {
    items.push(itemMatch[1])
  }
  return items
}

function mergeLocaleCodes(filesystemCodes: string[], configCodes: string[]): string[] {
  const seen = new Set(filesystemCodes)
  const merged = [...filesystemCodes]
  for (const code of configCodes) {
    if (!seen.has(code)) {
      seen.add(code)
      merged.push(code)
    }
  }
  return merged.sort()
}
