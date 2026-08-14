import { existsSync } from 'node:fs'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import type { FrameworkAdapter, LocaleFileFormat } from '../types'
import type { I18nConfig, LocaleDefinition, LocaleDir, AppInfo } from '../../config/types'
import { findNuxtConfig, discoverNuxtApps, deriveLayerName } from '../../config/discovery'
import { loadKit } from '../../config/nuxt-loader'
import { loadProjectConfig } from '../../config/project-config'
import { applyLocaleOverride } from '../../config/locale-override'
import { normalizeFallbackLocale } from '../../config/fallback-locale'
import { artifactToConfig, readArtifact } from '../../config/artifact'
import { log } from '../../utils/logger'
import { ConfigError, toErrorMessage } from '../../utils/errors'
import { claimLocaleDir } from './layer-dedup'
import { AppMerger } from './merge-apps'

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

    const [soleAppDir] = appDirs
    if (appDirs.length === 1 && soleAppDir !== undefined) {
      const config = await loadApp(soleAppDir, projectDir)
      if (soleAppDir !== projectDir) {
        config.rootDir = projectDir
        const rootApp = config.apps[0]
        if (rootApp) {
          rootApp.rootDir = projectDir
        }
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

/**
 * One app's config, preferring what @the-i18n-kit/nuxt published from inside
 * the build over reconstructing it from outside. The artifact is additive: any
 * reason not to trust it falls through to loading the app exactly as before,
 * so a project without the module — or with a stale one — behaves as it always
 * has.
 */
async function loadApp(appDir: string, discoveryRoot: string): Promise<I18nConfig> {
  const artifact = await readArtifact(appDir)
  if (!artifact) return loadSingleApp(appDir, discoveryRoot)

  const config = await artifactToConfig(artifact, appDir, discoveryRoot, await loadProjectConfig(discoveryRoot))

  // An artifact describing no locale directory leaves nothing to read, which
  // the fallback path reports as a ConfigError naming what is missing. Silently
  // returning an empty config instead would make installing the module turn a
  // clear error into no output at all.
  if (config.localeDirs.length === 0) {
    log.warn(`The artifact for ${appDir} describes no locale directories — loading the app instead.`)
    return loadSingleApp(appDir, discoveryRoot)
  }

  return config
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
  const merger = new AppMerger()

  for (const appDir of appDirs) {
    log.info(`Loading Nuxt app: ${relative(discoveryRoot, appDir) || '.'}`)

    let appConfig: I18nConfig
    try {
      appConfig = await loadApp(appDir, discoveryRoot)
    }
    catch (error) {
      // One unloadable app must not take the others with it: a monorepo where
      // a single app fails to build still has translations worth managing.
      log.warn(`Failed to load app at ${appDir}: ${toErrorMessage(error)}`)
      continue
    }

    await merger.add(appConfig, discoveryRoot)
  }

  if (merger.localeDirs.length === 0) {
    throw new ConfigError(
      `No locale directories found in any Nuxt app under ${discoveryRoot}. `
      + 'Make sure your Nuxt apps have i18n/locales/ directories with JSON files.',
    )
  }

  return merger.toConfig(
    discoveryRoot,
    projectConfig ?? undefined,
    applyLocaleOverride(merger.locales, projectConfig?.locales),
  )
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

  const fallbackLocale = normalizeFallbackLocale(i18nOptions.fallbackLocale, defaultLocale)
  const localeDirs = await discoverLocaleDirs(layers, i18nOptions, discoveryRoot)

  const layerRootDirs = [...new Set(layers.map(l => l.config.rootDir))]
  if (layerRootDirs.length === 0) {
    layerRootDirs.push(appDir)
  }

  const usedLayerNamesForApp = new Set<string>()
  const appLayerNames = layers.map(l => deriveLayerName(l.config.rootDir, discoveryRoot, usedLayerNamesForApp))
  const appName = deriveLayerName(appDir, discoveryRoot, new Set())
  const appInfo: AppInfo = { name: appName, rootDir: appDir, layers: appLayerNames }

  return {
    rootDir: appDir,
    defaultLocale,
    fallbackLocale,
    locales: applyLocaleOverride(locales, projectConfig?.locales),
    localeDirs,
    layerRootDirs,
    projectConfig: projectConfig ?? undefined,
    apps: [appInfo],
  }
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

    if (!resolvedPaths.has(realDir)) {
      const files = await readdir(resolvedDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      if (jsonFiles.length === 0) {
        log.debug(`No JSON files in locale dir for layer '${layerName}': ${resolvedDir}`)
        continue
      }
      log.debug(`Found locale dir for layer '${layerName}': ${resolvedDir} (${jsonFiles.length} files)`)
    }

    claimLocaleDir(dirs, resolvedPaths, { path: resolvedDir, layer: layerName, layerRootDir }, realDir)
  }

  if (dirs.length === 0) {
    throw new ConfigError(
      'No locale directories found. Make sure your Nuxt layers have i18n/locales/ directories with JSON files.',
    )
  }

  return dirs
}
