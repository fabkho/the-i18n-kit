import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../../config/types'
import { loadProjectConfig } from '../../config/project-config'
import { log } from '../../utils/logger'
import { ConfigError } from '../../utils/errors'

export class GenericAdapter implements FrameworkAdapter {
  readonly name = 'generic'
  readonly label = 'Generic'
  readonly localeFileFormat: LocaleFileFormat = 'json'

  private cachedConfig: { projectDir: string; config: import('../../config/types').ProjectConfig | null } | null = null

  private async getProjectConfig(projectDir: string) {
    if (this.cachedConfig?.projectDir === projectDir) {
      return this.cachedConfig.config
    }
    const config = await loadProjectConfig(projectDir)
    this.cachedConfig = { projectDir, config }
    return config
  }

  async detect(projectDir: string): Promise<number> {
    const config = await this.getProjectConfig(projectDir)
    if (!config) return 0
    if (config.localeDirs && config.localeDirs.length > 0 && config.defaultLocale) {
      return 10
    }
    return 0
  }

  async resolve(projectDir: string): Promise<I18nConfig> {
    const projectConfig = await this.getProjectConfig(projectDir)
    if (!projectConfig?.localeDirs || projectConfig.localeDirs.length === 0 || !projectConfig.defaultLocale) {
      throw new ConfigError(
        'GenericAdapter requires both "localeDirs" and "defaultLocale" in .i18n-mcp.json',
      )
    }

    const localeDirs: LocaleDir[] = projectConfig.localeDirs.map((entry) => {
      if (typeof entry === 'string') {
        return {
          path: resolve(projectDir, entry),
          layer: 'default',
          layerRootDir: projectDir,
        }
      }
      return {
        path: resolve(projectDir, entry.path),
        layer: entry.layer,
        layerRootDir: projectDir,
      }
    })

    for (const dir of localeDirs) {
      if (!existsSync(dir.path)) {
        throw new ConfigError(`Locale directory does not exist: ${dir.path}`)
      }
    }

    const detectedFormat = await detectFileFormat(localeDirs[0].path)
    const discoveredLocales = projectConfig.locales ?? await discoverLocales(localeDirs, detectedFormat)

    if (discoveredLocales.length === 0) {
      throw new ConfigError(
        `No locale files found in ${localeDirs.map(d => d.path).join(', ')}`,
      )
    }

    const locales: LocaleDefinition[] = discoveredLocales.map(code => ({
      code,
      language: code,
      ...(detectedFormat === 'json' ? { file: `${code}.json` } : {}),
    }))

    log.info(
      `Generic adapter: ${locales.length} locale(s), format=${detectedFormat}, `
      + `dirs=${localeDirs.map(d => d.layer).join(', ')}`,
    )

    return {
      rootDir: projectDir,
      defaultLocale: projectConfig.defaultLocale,
      fallbackLocale: { default: [projectConfig.defaultLocale] },
      locales,
      localeDirs,
      layerRootDirs: [projectDir],
      projectConfig,
      localeFileFormat: detectedFormat,
      apps: [{ name: 'default', rootDir: projectDir, layers: localeDirs.map(d => d.layer) }],
    }
  }
}

async function detectFileFormat(localeDir: string): Promise<LocaleFileFormat> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(localeDir, { withFileTypes: true })
  }
  catch {
    return 'json'
  }

  // Flat files: en.json, de.json
  if (entries.some(e => e.isFile() && e.name.endsWith('.json'))) {
    return 'json'
  }

  // Directory-per-locale: en/, de/ — check contents
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const subFiles = await readdir(join(localeDir, entry.name)).catch(() => [] as string[])
    if (subFiles.some(f => f.endsWith('.php'))) return 'php-array'
    if (subFiles.some(f => f.endsWith('.json'))) return 'json'
  }

  return 'json'
}

const NON_LOCALE_NAMES = new Set([
  'index', 'readme', 'config', 'vendor', 'node_modules', '.git', '.DS_Store',
])

async function discoverLocales(localeDirs: LocaleDir[], format: LocaleFileFormat): Promise<string[]> {
  const codes = new Set<string>()

  for (const dir of localeDirs) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir.path, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      if (entry.isFile() && entry.name.endsWith('.json') && format === 'json') {
        const code = entry.name.replace(/\.json$/, '')
        if (!NON_LOCALE_NAMES.has(code.toLowerCase())) {
          codes.add(code)
        }
      }
      else if (entry.isDirectory() && !NON_LOCALE_NAMES.has(entry.name.toLowerCase())) {
        const subFiles = await readdir(join(dir.path, entry.name)).catch(() => [] as string[])
        const ext = format === 'php-array' ? '.php' : '.json'
        if (subFiles.some(f => f.endsWith(ext))) {
          codes.add(entry.name)
        }
      }
    }
  }

  return [...codes].sort()
}
