import { existsSync, statSync, readdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition } from '../../config/types'
import { loadProjectConfig } from '../../config/project-config'
import { readNextI18n } from '../../config/framework/next'
import { applyLocaleOverride } from '../../config/locale-override'
import { ConfigError } from '../../utils/errors'
import { loadPackageJson, collectDependencies, hasNuxtConfig, noLocaleDirError, buildSingleDirConfig } from '../shared'

const COMMON_LOCALE_DIRS = [
  'messages',
  'public/locales',
  'locales',
  'src/i18n',
  'src/locales',
  'i18n',
]

const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.js', 'next.config.mjs']

const NUXT_INDICATORS = ['@nuxt/kit', 'nuxt']
const VUE_INDICATORS = ['vue']

const I18N_DEPS = ['next-intl', 'next-translate', 'next-i18next', 'react-i18next', 'react-intl']

const SKIP_DIRS = new Set(['node_modules', '.git', '.DS_Store'])

export class ReactAdapter implements FrameworkAdapter {
  readonly name = 'react'
  readonly label = 'React / Next.js'
  readonly localeFileFormat: LocaleFileFormat = 'json'

  async detect(projectDir: string): Promise<number> {
    const pkg = await loadPackageJson(projectDir)
    if (!pkg) return 0

    const allDeps = collectDependencies(pkg)
    if (isConflictingFramework(projectDir, allDeps)) return 0

    const isNext = 'next' in allDeps
    const isReact = 'react' in allDeps && 'react-dom' in allDeps

    if (!isNext && !isReact) return 0

    return computeScore(projectDir, allDeps, isNext)
  }

  async resolve(projectDir: string): Promise<I18nConfig> {
    const projectConfig = await loadProjectConfig(projectDir)

    const localeDir = await findLocaleDir(projectDir)
    if (!localeDir) {
      throw noLocaleDirError(projectDir, COMMON_LOCALE_DIRS)
    }

    const locales = await discoverLocales(localeDir)
    const [firstLocale] = locales
    if (firstLocale === undefined) {
      throw new ConfigError(
        `No locale files found in ${localeDir}. `
        + 'Make sure your React/Next.js project has locale directories like messages/en/ or locale JSON files.',
      )
    }

    // Declared first, then what the project already tells next-intl or Next
    // itself, and only then directory order — which is not a statement about
    // the default locale at all, merely the alphabet (#296).
    const framework = await readNextI18n(projectDir)
    const defaultLocale = projectConfig?.defaultLocale ?? framework?.defaultLocale ?? firstLocale.code

    return buildSingleDirConfig({
      projectDir,
      localeDir,
      defaultLocale,
      locales: applyLocaleOverride(locales, projectConfig?.locales),
      projectConfig,
    })
  }
}

// ─── Detection helpers ──────────────────────────────────────────

function isConflictingFramework(projectDir: string, deps: Record<string, unknown>): boolean {
  for (const indicator of NUXT_INDICATORS) {
    if (indicator in deps) return true
  }
  for (const indicator of VUE_INDICATORS) {
    if (indicator in deps) return true
  }
  return hasNuxtConfig(projectDir)
}

function hasNextConfig(projectDir: string): boolean {
  return NEXT_CONFIG_FILES.some(f => existsSync(join(projectDir, f)))
}

async function computeScore(
  projectDir: string,
  deps: Record<string, unknown>,
  isNext: boolean,
): Promise<number> {
  let score = isNext ? 5 : 3

  if (I18N_DEPS.some(dep => dep in deps)) score += 2

  if (isNext && hasNextConfig(projectDir)) score += 1

  try {
    const localeDir = findLocaleDirSync(projectDir)
    if (localeDir) {
      const entries = readdirSync(localeDir)
      if (entries.some(e => isLocaleContent(join(localeDir, e)))) score += 2
    }
  }
  catch {
    // Can't read dirs — skip bonus
  }

  return score
}

// ─── Resolution helpers ─────────────────────────────────────────

async function findLocaleDir(projectDir: string): Promise<string | null> {
  const fromConfig = await tryNextConfig(projectDir)
  if (fromConfig) return fromConfig

  return findLocaleDirSync(projectDir)
}

function findLocaleDirSync(projectDir: string): string | null {
  for (const dir of COMMON_LOCALE_DIRS) {
    const fullPath = join(projectDir, dir)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

function isLocaleContent(path: string): boolean {
  if (path.endsWith('.json')) return true
  return isLocaleSubdir(path)
}

function isLocaleSubdir(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    if (!statSync(path).isDirectory()) return false
    const files = readdirSync(path)
    return files.some(f => f.endsWith('.json'))
  }
  catch {
    return false
  }
}

async function tryNextConfig(projectDir: string): Promise<string | null> {
  for (const file of NEXT_CONFIG_FILES) {
    const fullPath = join(projectDir, file)
    if (!existsSync(fullPath)) continue

    const result = await tryExtractFromNextConfig(projectDir, fullPath)
    if (result) return result
  }

  return null
}

async function tryExtractFromNextConfig(
  projectDir: string,
  configPath: string,
): Promise<string | null> {
  try {
    const content = await readFile(configPath, 'utf-8')

    if (/createNextIntlPlugin/.test(content) && existsSync(join(projectDir, 'messages'))) {
      return join(projectDir, 'messages')
    }

    if (/next-translate/.test(content) && existsSync(join(projectDir, 'locales'))) {
      return join(projectDir, 'locales')
    }

    return tryExtractPathFromConfig(projectDir, content)
  }
  catch {
    return null
  }
}

function tryExtractPathFromConfig(projectDir: string, content: string): string | null {
  const pathMatch = content.match(/(?:messages|localeDir|locales)\s*:\s*['"]([^'"]+)/)
  const rawPath = pathMatch?.[1]
  if (!rawPath) return null

  const path = rawPath.replace(/\/\*\/\*$/, '').replace(/\/\*$/, '')
  return existsSync(join(projectDir, path)) ? join(projectDir, path) : null
}

async function discoverLocales(localeDir: string): Promise<LocaleDefinition[]> {
  let entries: string[]
  try {
    entries = await readdir(localeDir)
  }
  catch {
    return []
  }

  const localeCodes = new Set<string>()

  // Namespaced layout: messages/en/common.json
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const fullPath = join(localeDir, entry)
    if (isLocaleSubdir(fullPath)) localeCodes.add(entry)
  }

  if (localeCodes.size > 0) {
    return [...localeCodes].sort().map(code => ({
      code,
      language: code,
    }))
  }

  // Flat JSON layout: locales/en.json — `file` is required here, otherwise
  // resolveLocaleEntries cannot resolve flat entries and every read/write
  // becomes a silent no-op (#194).
  return entries
    .filter(entry => entry.endsWith('.json'))
    .sort()
    .map(file => ({
      code: file.replace(/\.json$/, ''),
      language: file.replace(/\.json$/, ''),
      file,
    }))
}
