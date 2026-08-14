import { existsSync, statSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { AppInfo, I18nConfig, LocaleDefinition, LocaleDir, ProjectConfig } from './types.js'
import { deriveLayerName, findNuxtConfig } from './discovery.js'
import { applyLocaleOverride } from './locale-override.js'
import { normalizeFallbackLocale } from './fallback-locale.js'
import { claimLocaleDir } from '../adapters/nuxt/layer-dedup.js'
import { log } from '../utils/logger.js'

/** Where @the-i18n-kit/nuxt publishes what Nuxt resolved, relative to an app. */
const ARTIFACT_PATH = '.nuxt/i18n-kit.json'

const localeSchema = z.object({
  code: z.string().min(1),
  language: z.string(),
  file: z.string().min(1),
  name: z.string().optional(),
})

const layerSchema = z.object({
  rootDir: z.string().min(1),
  localeDir: z.string().min(1).optional(),
})

const artifactSchema = z.object({
  version: z.literal(1),
  generator: z.string(),
  appDir: z.string().min(1),
  defaultLocale: z.string().min(1),
  // As Nuxt resolved it, in any of the three shapes @nuxtjs/i18n accepts.
  // Normalising it here rather than in the module keeps one implementation.
  fallbackLocale: z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    z.null(),
  ]),
  localeFileFormat: z.literal('json'),
  locales: z.array(localeSchema).min(1),
  layers: z.array(layerSchema).min(1),
})

export type I18nKitArtifact = z.infer<typeof artifactSchema>

/**
 * Read an app's artifact, or null when there isn't a usable one.
 *
 * Never throws: every failure here — absent, malformed, a version this CLI
 * does not know, or older than the config it claims to describe — means
 * falling back to loading the app through Nuxt, which is what happens today
 * anyway. A module that cannot be trusted must not be able to break a project
 * that worked without it.
 */
export async function readArtifact(appDir: string): Promise<I18nKitArtifact | null> {
  const path = resolve(appDir, ARTIFACT_PATH)
  if (!existsSync(path)) return null

  if (isStale(appDir, path)) {
    log.warn(
      `Ignoring ${path}: the Nuxt config has changed since it was generated. `
      + 'Run `nuxt prepare` to refresh it — falling back to loading the app.',
    )
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'))
  }
  catch (error) {
    log.warn(`Ignoring ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  const result = artifactSchema.safeParse(parsed)
  if (!result.success) {
    const [issue] = result.error.issues
    const where = issue?.path.join('.') || '(root)'
    log.warn(`Ignoring ${path}: not a shape this CLI understands (${where}: ${issue?.message}).`)
    return null
  }

  log.info(`Using the layer graph published by ${result.data.generator}`)
  return result.data
}

/**
 * An artifact older than the config it describes is a lie about the current
 * project, and a quiet one. Cheaper to distrust it than to explain later why
 * a renamed locale never took effect.
 */
function isStale(appDir: string, artifactPath: string): boolean {
  const configFile = findNuxtConfig(appDir)
  if (!configFile) return false

  try {
    return statSync(resolve(appDir, configFile)).mtimeMs > statSync(artifactPath).mtimeMs
  }
  catch {
    return false
  }
}

/**
 * Turn one app's artifact into the config shape every command consumes.
 *
 * Layer *names* are derived here rather than read from the artifact: they
 * depend on the directory the CLI was pointed at, which the module cannot
 * know. Deriving them in one place is what keeps the artifact path and the
 * fallback path producing the same names for the same project.
 */
export async function artifactToConfig(
  artifact: I18nKitArtifact,
  appDir: string,
  discoveryRoot: string,
  projectConfig: ProjectConfig | null,
): Promise<I18nConfig> {
  const localeDirs: LocaleDir[] = []
  const claimed = new Map<string, { layer: string, layerRootDir: string }>()
  const usedLayerNames = new Set<string>()

  for (const layer of artifact.layers) {
    // Named before the locale-dir check, and unconditionally: a layer without
    // translations still consumes its name, so that layers with translations
    // get the same names they would on the fallback path.
    const layerName = deriveLayerName(layer.rootDir, discoveryRoot, usedLayerNames)
    usedLayerNames.add(layerName)

    if (!layer.localeDir) continue

    const realDir = await realpath(layer.localeDir).catch(() => layer.localeDir!)
    claimLocaleDir(
      localeDirs,
      claimed,
      { path: layer.localeDir, layer: layerName, layerRootDir: layer.rootDir },
      realDir,
    )
  }

  const layerRootDirs = [...new Set(artifact.layers.map(l => l.rootDir))]
  if (layerRootDirs.length === 0) layerRootDirs.push(appDir)

  const namesForApp = new Set<string>()
  const app: AppInfo = {
    name: deriveLayerName(appDir, discoveryRoot, new Set()),
    rootDir: appDir,
    layers: artifact.layers.map(l => deriveLayerName(l.rootDir, discoveryRoot, namesForApp)),
  }

  const locales: LocaleDefinition[] = artifact.locales.map(l => ({
    code: l.code,
    language: l.language,
    file: l.file,
    ...(l.name === undefined ? {} : { name: l.name }),
  }))

  return {
    rootDir: appDir,
    defaultLocale: artifact.defaultLocale,
    fallbackLocale: normalizeFallbackLocale(artifact.fallbackLocale, artifact.defaultLocale),
    locales: applyLocaleOverride(locales, projectConfig?.locales),
    localeDirs,
    layerRootDirs,
    projectConfig: projectConfig ?? undefined,
    apps: [app],
  }
}
