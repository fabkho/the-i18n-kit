import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition } from '../../config/types'
import { loadProjectConfig } from '../../config/project-config'
import { applyLocaleOverride } from '../../config/locale-override'
import { log } from '../../utils/logger'
import { ConfigError } from '../../utils/errors'

const COMMON_LOCALE_DIRS = [
  'src/locales',
  'locales',
  'src/i18n/locales',
  'i18n/locales',
  'src/plugins/i18n/locales',
  'src/i18n',
]

const I18N_CONFIG_FILES = [
  'src/i18n/index.ts',
  'src/i18n/index.js',
  'src/plugins/i18n.ts',
  'src/plugins/i18n.js',
  'src/i18n.ts',
  'src/i18n.js',
  'i18n.ts',
  'i18n.js',
]

const NUPT_INDICATORS = ['@nuxt/kit', 'nuxt']

const MESSAGES_REGEX = /messages\s*:\s*['"]([^'"]+)/
const LOCALE_DIR_REGEX = /localeDir\s*:\s*['"]([^'"]+)/

export class VueAdapter implements FrameworkAdapter {
  readonly name = 'vue'
  readonly label = 'Vue'
  readonly localeFileFormat: LocaleFileFormat = 'json'

  async detect(projectDir: string): Promise<number> {
    const pkg = await loadPackageJson(projectDir)
    if (!pkg) return 0

    const allDeps = collectDependencies(pkg)
    if (isNuxtProject(projectDir, allDeps)) return 0
    if (!('vue' in allDeps)) return 0

    return computeScore(projectDir, allDeps)
  }

  async resolve(projectDir: string): Promise<I18nConfig> {
    const projectConfig = await loadProjectConfig(projectDir)

    const localeDir = await findLocaleDir(projectDir)
    if (!localeDir) {
      throw new ConfigError(
        `No locale directory found in ${projectDir}. `
        + 'Looked in: ' + COMMON_LOCALE_DIRS.join(', ') + '. '
        + 'Configure a .i18n-mcp.json with localeDirs for custom paths.',
      )
    }

    const locales = await discoverLocales(localeDir)
    if (locales.length === 0) {
      throw new ConfigError(
        `No JSON locale files found in ${localeDir}. `
        + 'Make sure your Vue i18n project has locale files like en.json, de.json etc.',
      )
    }

    const defaultLocale = extractDefaultLocale(projectDir) ?? locales[0].code
    const fallbackLocale = { default: [defaultLocale] }

    return {
      rootDir: projectDir,
      defaultLocale,
      fallbackLocale,
      locales: applyLocaleOverride(locales, projectConfig?.locales),
      localeDirs: [{ path: localeDir, layer: 'root', layerRootDir: projectDir }],
      layerRootDirs: [projectDir],
      projectConfig: projectConfig ?? undefined,
      apps: [{ name: 'default', rootDir: projectDir, layers: ['root'] }],
    }
  }
}

// ─── Detection helpers ──────────────────────────────────────────

async function loadPackageJson(projectDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(projectDir, 'package.json'), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    return null
  }
}

function collectDependencies(pkg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(pkg.dependencies ?? {}) as Record<string, unknown>,
    ...(pkg.devDependencies ?? {}) as Record<string, unknown>,
  }
}

function isNuxtProject(projectDir: string, deps: Record<string, unknown>): boolean {
  for (const indicator of NUPT_INDICATORS) {
    if (indicator in deps) return true
  }
  return findNuxtConfig(projectDir) !== null
}

async function computeScore(projectDir: string, deps: Record<string, unknown>): Promise<number> {
  let score = 2 // 'vue' already confirmed present
  if ('vue-i18n' in deps) score += 3

  try {
    const localeDir = await findLocaleDir(projectDir)
    if (localeDir) {
      const files = await readdir(localeDir)
      if (files.some(f => f.endsWith('.json'))) score += 2
    }
  }
  catch {
    // Can't read dirs — skip bonus
  }

  return score
}

// ─── Resolution helpers ─────────────────────────────────────────

function findNuxtConfig(dir: string): string | null {
  for (const name of ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']) {
    if (existsSync(join(dir, name))) return name
  }
  return null
}

async function findLocaleDir(projectDir: string): Promise<string | null> {
  const fromConfig = await tryExtractFromConfig(projectDir)
  if (fromConfig) return fromConfig

  return tryCommonPaths(projectDir)
}

async function tryExtractFromConfig(projectDir: string): Promise<string | null> {
  for (const file of I18N_CONFIG_FILES) {
    const fullPath = join(projectDir, file)
    if (!existsSync(fullPath)) continue

    try {
      const content = await readFile(fullPath, 'utf-8')

      const dirMatch = content.match(LOCALE_DIR_REGEX)
      if (dirMatch) {
        const extracted = resolve(projectDir, dirMatch[1])
        if (existsSync(extracted)) return extracted
      }

      const msgMatch = content.match(MESSAGES_REGEX)
      if (msgMatch) {
        const configDir = fullPath.replace(/\/[^/]+$/, '')
        const extracted = resolve(configDir, msgMatch[1])
        const parentDir = extracted.replace(/\/[^/]+$/, '')
        if (existsSync(parentDir)) return parentDir
      }
    }
    catch {
      // Can't read — try next
    }
  }

  return null
}

function tryCommonPaths(projectDir: string): string | null {
  for (const dir of COMMON_LOCALE_DIRS) {
    const fullPath = join(projectDir, dir)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

async function discoverLocales(localeDir: string): Promise<LocaleDefinition[]> {
  let files: string[]
  try {
    files = await readdir(localeDir)
  }
  catch {
    return []
  }

  return files
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({
      code: f.replace(/\.json$/, ''),
      language: f.replace(/\.json$/, ''),
      file: f,
    }))
}

function extractDefaultLocale(projectDir: string): string | null {
  // Not critical — return null if .env doesn't exist or can't be read
  return null
}
