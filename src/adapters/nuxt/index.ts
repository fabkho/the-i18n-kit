import { existsSync } from 'node:fs'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../../config/types'
import { findNuxtConfig, discoverNuxtApps, deriveLayerName } from '../../config/discovery'
import { loadKit } from '../../config/nuxt-loader'
import { loadProjectConfig } from '../../config/project-config'
import { log } from '../../utils/logger'
import { ConfigError } from '../../utils/errors'
import { resolveLayerOwnership } from './layer-dedup'

export class NuxtAdapter implements FrameworkAdapter {
  readonly name = 'nuxt'
  readonly label = 'Nuxt'
  readonly localeFileFormat: LocaleFileFormat = 'json'

  async detect(projectDir: string): Promise<number> {
    const configFile = findNuxtConfig(projectDir)
    if (configFile) {
      try {
        const content = await readFile(resolve(projectDir, configFile), 'utf-8')
        if (/\bi18n\b/.test(content)) return 2
      }
      catch {
        // Fall through to child app scan
      }

      // Root config exists but has no i18n — check child apps
      const appDirs = await discoverNuxtApps(projectDir)
      return appDirs.length > 0 ? 2 : 1
    }

    const appDirs = await discoverNuxtApps(projectDir)
    return appDirs.length > 0 ? 2 : 0
  }

  async resolve(projectDir: string): Promise<I18nConfig> {
    const appDirs = await discoverNuxtApps(projectDir)

    if (findNuxtConfig(projectDir) && !appDirs.includes(projectDir)) {
      appDirs.unshift(projectDir)
    }

    if (appDirs.length === 0) {
      throw new ConfigError(
        `No Nuxt apps with i18n configuration found under ${projectDir}. `
        + 'Make sure your Nuxt apps have a nuxt.config.ts with i18n configured.',
      )
    }

    if (appDirs.length === 1) {
      const config = await loadSingleApp(appDirs[0], projectDir)
      if (appDirs[0] !== projectDir) {
        config.rootDir = projectDir
      }
      log.info(`Detected ${config.locales.length} locales, ${config.localeDirs.length} locale directories`)
      return config
    }

    log.info(`Discovered ${appDirs.length} Nuxt app(s) with i18n: ${appDirs.map(d => relative(projectDir, d) || '.').join(', ')}`)
    const config = await loadAndMergeApps(appDirs, projectDir)
    log.info(`Detected ${config.locales.length} locales, ${config.localeDirs.length} locale directories from ${appDirs.length} app(s)`)
    return config
  }
}

async function loadSingleApp(appDir: string, discoveryRoot: string): Promise<I18nConfig> {
  const kit = await loadKit(appDir)

  let nuxt: Awaited<ReturnType<typeof kit.loadNuxt>>

  try {
    nuxt = await kit.loadNuxt({
      cwd: appDir,
      dotenv: { cwd: appDir },
      overrides: {
        logLevel: 'silent' as const,
        vite: { clearScreen: false },
      },
    })
  }
  catch (_error) {
    log.warn(`Initial loadNuxt failed for ${appDir}, retrying with ready:false...`)
    try {
      nuxt = await kit.loadNuxt({
        cwd: appDir,
        dotenv: { cwd: appDir },
        ready: false,
        overrides: {
          logLevel: 'silent' as const,
          vite: { clearScreen: false },
        },
      })
    }
    catch (retryError) {
      throw new ConfigError(
        `Failed to load Nuxt config from ${appDir}: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
      )
    }
  }

  try {
    return await extractI18nConfig(nuxt as unknown as { options: Record<string, unknown> }, appDir, discoveryRoot)
  }
  finally {
    await nuxt.close()
  }
}

async function loadAndMergeApps(appDirs: string[], discoveryRoot: string): Promise<I18nConfig> {
  const projectConfig = await loadProjectConfig(discoveryRoot)

  const allLocaleDirs: LocaleDir[] = []
  const allLocales: LocaleDefinition[] = []
  const allLayerRootDirs: string[] = []
  const seenLocalePaths = new Map<string, { layer: string, layerRootDir: string }>()
  const seenLocaleCodes = new Set<string>()
  const usedLayerNames = new Set<string>()
  let defaultLocale = 'en'
  let fallbackLocale: Record<string, string[]> = { default: ['en'] }

  for (const appDir of appDirs) {
    log.info(`Loading Nuxt app: ${relative(discoveryRoot, appDir) || '.'}`)
    let appConfig: I18nConfig
    try {
      appConfig = await loadSingleApp(appDir, discoveryRoot)
    }
    catch (error) {
      log.warn(`Failed to load app at ${appDir}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (allLocaleDirs.length === 0) {
      defaultLocale = appConfig.defaultLocale
      fallbackLocale = appConfig.fallbackLocale
    }

    for (const dir of appConfig.localeDirs) {
      const realPath = await realpath(dir.path).catch(() => dir.path)
      const existing = seenLocalePaths.get(realPath)
      if (existing) {
        const { owner, alias } = resolveLayerOwnership(
          { layer: existing.layer, layerRootDir: existing.layerRootDir },
          { layer: dir.layer, layerRootDir: dir.layerRootDir },
          realPath,
        )
        if (owner !== existing.layer) {
          const ownerIndex = allLocaleDirs.findIndex(d => d.layer === existing.layer && !d.aliasOf)
          if (ownerIndex !== -1) {
            const prev = allLocaleDirs[ownerIndex]
            allLocaleDirs[ownerIndex] = { ...dir, layer: owner === dir.layer ? dir.layer : owner }
            allLocaleDirs.push({ ...prev, aliasOf: owner === dir.layer ? dir.layer : owner })
            seenLocalePaths.set(realPath, { layer: allLocaleDirs[ownerIndex].layer, layerRootDir: allLocaleDirs[ownerIndex].layerRootDir })
            log.debug(`Layer '${alias}' is alias of '${owner}' (ancestor-based ownership, same path: ${dir.path})`)
          }
        }
        else {
          if (dir.layer !== existing.layer) {
            allLocaleDirs.push({
              ...dir,
              layer: alias === dir.layer ? dir.layer : alias,
              aliasOf: owner,
            })
            log.debug(`Layer '${alias}' is alias of '${owner}' (same path: ${dir.path})`)
          }
        }
        continue
      }

      let layerName = dir.layer
      if (usedLayerNames.has(layerName)) {
        layerName = deriveLayerName(dir.layerRootDir, discoveryRoot, usedLayerNames)
      }
      usedLayerNames.add(layerName)
      seenLocalePaths.set(realPath, { layer: layerName, layerRootDir: dir.layerRootDir })
      allLocaleDirs.push({ ...dir, layer: layerName })
    }

    for (const locale of appConfig.locales) {
      if (!seenLocaleCodes.has(locale.code)) {
        seenLocaleCodes.add(locale.code)
        allLocales.push(locale)
      }
    }

    for (const rootDir of appConfig.layerRootDirs) {
      if (!allLayerRootDirs.includes(rootDir)) {
        allLayerRootDirs.push(rootDir)
      }
    }
  }

  if (allLocaleDirs.length === 0) {
    throw new ConfigError(
      `No locale directories found in any Nuxt app under ${discoveryRoot}. `
      + 'Make sure your Nuxt apps have i18n/locales/ directories with JSON files.',
    )
  }

  return {
    rootDir: discoveryRoot,
    defaultLocale,
    fallbackLocale,
    locales: allLocales,
    localeDirs: allLocaleDirs,
    layerRootDirs: allLayerRootDirs,
    projectConfig: projectConfig ?? undefined,
  }
}

async function extractI18nConfig(
  nuxt: { options: Record<string, unknown> },
  appDir: string,
  discoveryRoot: string,
): Promise<I18nConfig> {
  const projectConfig = await loadProjectConfig(discoveryRoot)

  const nuxtOptions = nuxt.options as Record<string, unknown>
  const i18nOptions = nuxtOptions.i18n as Record<string, unknown> | undefined
  const layers = (nuxtOptions._layers ?? []) as Array<{
    config: {
      rootDir: string
      i18n?: Record<string, unknown>
    }
  }>

  if (!i18nOptions) {
    throw new ConfigError(
      `No i18n configuration found in nuxt.config at ${appDir}. Make sure @nuxtjs/i18n is configured.`,
    )
  }

  const defaultLocale = (i18nOptions.defaultLocale as string) ?? 'en'
  log.debug(`Default locale: ${defaultLocale}`)

  const rawLocales = (i18nOptions.locales ?? []) as Array<Record<string, unknown>>
  const locales: LocaleDefinition[] = rawLocales
    .filter(l => typeof l === 'object' && l !== null)
    .map(l => ({
      code: String(l.code ?? ''),
      language: String(l.language ?? l.iso ?? ''),
      file: String(l.file ?? ''),
      name: l.name ? String(l.name) : undefined,
    }))
    .filter(l => l.code && l.file)

  if (locales.length === 0) {
    throw new ConfigError(
      'No locales found in i18n configuration. Make sure locales are defined with code and file properties.',
    )
  }

  const fallbackLocale = extractFallbackLocale(i18nOptions)
  const localeDirs = await discoverLocaleDirs(layers, i18nOptions, discoveryRoot)

  const layerRootDirs = [...new Set(layers.map(l => l.config.rootDir))]
  if (layerRootDirs.length === 0) {
    layerRootDirs.push(appDir)
  }

  return {
    rootDir: appDir,
    defaultLocale,
    fallbackLocale,
    locales,
    localeDirs,
    layerRootDirs,
    projectConfig: projectConfig ?? undefined,
  }
}

function extractFallbackLocale(
  i18nOptions: Record<string, unknown>,
): Record<string, string[]> {
  const fallback = i18nOptions.fallbackLocale

  if (typeof fallback === 'string') {
    return { default: [fallback] }
  }

  if (Array.isArray(fallback)) {
    return { default: (fallback as unknown[]).map(String) }
  }

  if (fallback && typeof fallback === 'object') {
    const result: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(fallback as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = value.map(String)
      }
      else if (typeof value === 'string') {
        result[key] = [value]
      }
    }
    return result
  }

  const defaultLocale = (i18nOptions.defaultLocale as string) ?? 'en'
  return { default: [defaultLocale] }
}

async function discoverLocaleDirs(
  layers: Array<{ config: { rootDir: string; i18n?: Record<string, unknown> } }>,
  i18nOptions: Record<string, unknown>,
  discoveryRoot: string,
): Promise<LocaleDir[]> {
  const dirs: LocaleDir[] = []
  const resolvedPaths = new Map<string, { layer: string, layerRootDir: string }>()
  const usedLayerNames = new Set<string>()

  for (const layer of layers) {
    const layerRootDir = layer.config.rootDir
    const layerName = deriveLayerName(layerRootDir, discoveryRoot, usedLayerNames)
    usedLayerNames.add(layerName)
    const layerI18n = layer.config.i18n ?? i18nOptions

    const langDir = (layerI18n.langDir as string) ?? 'locales'
    const restructureDir = (layerI18n.restructureDir as string) ?? 'i18n'
    const resolvedDir = resolve(layerRootDir, restructureDir, langDir)

    if (!existsSync(resolvedDir)) {
      log.debug(`Locale dir not found for layer '${layerName}': ${resolvedDir}`)
      continue
    }

    const realDir = await realpath(resolvedDir).catch(() => resolvedDir)
    const existing = resolvedPaths.get(realDir)
    if (existing) {
      const { owner, alias } = resolveLayerOwnership(
        { layer: existing.layer, layerRootDir: existing.layerRootDir },
        { layer: layerName, layerRootDir },
        realDir,
      )
      if (owner !== existing.layer) {
        const ownerIndex = dirs.findIndex(d => d.layer === existing.layer && !d.aliasOf)
        if (ownerIndex !== -1) {
          const prev = dirs[ownerIndex]
          dirs[ownerIndex] = {
            path: resolvedDir,
            layer: layerName,
            layerRootDir,
          }
          dirs.push({ ...prev, aliasOf: layerName })
          resolvedPaths.set(realDir, { layer: layerName, layerRootDir })
          log.debug(`Layer '${alias}' is alias of '${owner}' (ancestor-based ownership)`)
        }
      }
      else {
        dirs.push({
          path: resolvedDir,
          layer: layerName,
          layerRootDir,
          aliasOf: existing.layer,
        })
        log.debug(`Layer '${alias}' is alias of '${owner}'`)
      }
      continue
    }

    const files = await readdir(resolvedDir)
    const jsonFiles = files.filter(f => f.endsWith('.json'))
    if (jsonFiles.length === 0) {
      log.debug(`No JSON files in locale dir for layer '${layerName}': ${resolvedDir}`)
      continue
    }

    resolvedPaths.set(realDir, { layer: layerName, layerRootDir })
    dirs.push({
      path: resolvedDir,
      layer: layerName,
      layerRootDir,
    })

    log.debug(`Found locale dir for layer '${layerName}': ${resolvedDir} (${jsonFiles.length} files)`)
  }

  if (dirs.length === 0) {
    throw new ConfigError(
      'No locale directories found. Make sure your Nuxt layers have i18n/locales/ directories with JSON files.',
    )
  }

  return dirs
}
