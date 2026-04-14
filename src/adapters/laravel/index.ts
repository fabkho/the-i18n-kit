import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../../config/types'
import { loadProjectConfig } from '../../config/project-config'
import { log } from '../../utils/logger'
import { ConfigError } from '../../utils/errors'

export class LaravelAdapter implements FrameworkAdapter {
  readonly name = 'laravel'
  readonly label = 'Laravel'
  readonly localeFileFormat: LocaleFileFormat = 'php-array'

  async detect(projectDir: string): Promise<number> {
    let score = 0

    // Strong signal: artisan file is the hallmark of a Laravel project
    if (existsSync(join(projectDir, 'artisan'))) {
      score += 2
    }

    // Strong signal: composer.json with laravel/framework dependency
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

    // Weak signal: lang/ directory with locale subdirectories
    const langDir = findLangDir(projectDir)
    if (langDir) {
      const localeSubdirs = await findLocaleSubdirs(langDir)
      if (localeSubdirs.length > 0) {
        score += 1
      }
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

    const localeSubdirs = await findLocaleSubdirs(langDir)
    if (localeSubdirs.length === 0) {
      throw new ConfigError(
        `No locale subdirectories found in ${langDir}. `
        + 'Expected directories like lang/en/, lang/de/, etc.',
      )
    }

    const { defaultLocale, fallbackLocale, configLocales } = await extractLocaleConfig(projectDir)

    const allCodes = mergeLocaleCodes(localeSubdirs, configLocales)

    const locales: LocaleDefinition[] = allCodes.map(code => ({
      code,
      language: code,
    }))

    const localeDirs: LocaleDir[] = [{
      path: langDir,
      layer: 'root',
      layerRootDir: projectDir,
    }]

    log.info(
      `Discovered ${locales.length} locale(s) in ${langDir}: `
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
      localeFileFormat: 'php-array',
    }
  }
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

/**
 * Extract default and fallback locale from config/app.php.
 * Uses regex to handle patterns like:
 *   'locale' => 'en',
 *   'locale' => env('APP_LOCALE', 'en'),
 *   'fallback_locale' => 'en',
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

/**
 * Extract a string config value from a PHP config file.
 * Handles both direct string values and env() calls with defaults:
 *   'key' => 'value',
 *   'key' => env('ENV_VAR', 'default'),
 *   "key" => "value",
 */
function extractPhpConfigValue(content: string, key: string): string | null {
  // Match: 'key' => env('...', 'default')  or  "key" => env("...", "default")
  const envPattern = new RegExp(
    `['"]${key}['"]\\s*=>\\s*env\\s*\\(\\s*['"][^'"]*['"]\\s*,\\s*['"]([^'"]+)['"]\\s*\\)`,
  )
  const envMatch = content.match(envPattern)
  if (envMatch) {
    return envMatch[1]
  }

  // Match: 'key' => 'value'  or  "key" => "value"
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
