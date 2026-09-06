import { realpath } from 'node:fs/promises'
import type { AppInfo, I18nConfig, LocaleDefinition, LocaleDir } from '../../config/types'
import { deriveLayerName } from '../../config/paths'
import { claimLocaleDir } from './layer-dedup'

/**
 * Folds several Nuxt apps into one project config.
 *
 * A monorepo's apps overlap: they extend the same root layer, sometimes alias
 * each other's locale directories, and each reports the full locale table its
 * layers declare. Merging them is therefore four separate reconciliations —
 * directories claimed once by real path, locales deduplicated by code, layer
 * roots kept unique, and app→layer edges rewritten to whatever the directory
 * ended up being called. Keeping that state in one place stops the caller from
 * having to hold all four in its head at once.
 */
export class AppMerger {
  readonly localeDirs: LocaleDir[] = []
  readonly locales: LocaleDefinition[] = []
  readonly layerRootDirs: string[] = []
  readonly apps: AppInfo[] = []

  defaultLocale = 'en'
  fallbackLocale: Record<string, string[]> = { default: ['en'] }

  private readonly claimedPaths = new Map<string, { layer: string, layerRootDir: string }>()
  private readonly seenLocaleCodes = new Set<string>()
  private readonly usedLayerNames = new Set<string>()

  async add(appConfig: I18nConfig, discoveryRoot: string): Promise<void> {
    // The first app to be merged sets the project defaults. Checked against the
    // directories rather than a flag, so an app that contributed none does not
    // get to claim them.
    if (this.localeDirs.length === 0) {
      this.defaultLocale = appConfig.defaultLocale
      this.fallbackLocale = appConfig.fallbackLocale
    }

    const renamedLayers = await this.claimDirs(appConfig, discoveryRoot)
    this.collectLocales(appConfig)
    this.collectLayerRoots(appConfig)
    this.collectApps(appConfig, renamedLayers)
  }

  toConfig(discoveryRoot: string, projectConfig: I18nConfig['projectConfig'], locales: LocaleDefinition[]): I18nConfig {
    return {
      rootDir: discoveryRoot,
      defaultLocale: this.defaultLocale,
      fallbackLocale: this.fallbackLocale,
      locales,
      localeDirs: this.localeDirs,
      layerRootDirs: this.layerRootDirs,
      projectConfig,
      apps: this.apps,
    }
  }

  /**
   * Claim each of this app's locale directories, renaming a layer whose name is
   * already taken by a different directory. Returns the renames, because the
   * app's own layer list still refers to the old names.
   */
  private async claimDirs(appConfig: I18nConfig, discoveryRoot: string): Promise<Map<string, string>> {
    const renamed = new Map<string, string>()

    for (const dir of appConfig.localeDirs) {
      const realPath = await realpath(dir.path).catch(() => dir.path)

      // An already-claimed path keeps the name its first claimant gave it;
      // claimLocaleDir records this app as an alias of that layer.
      let claim = dir
      if (!this.claimedPaths.has(realPath)) {
        const layer = this.uniqueLayerName(dir, discoveryRoot)
        if (layer !== dir.layer) renamed.set(dir.layer, layer)
        this.usedLayerNames.add(layer)
        claim = { ...dir, layer }
      }

      claimLocaleDir(this.localeDirs, this.claimedPaths, claim, realPath)
    }

    return renamed
  }

  private uniqueLayerName(dir: LocaleDir, discoveryRoot: string): string {
    if (!this.usedLayerNames.has(dir.layer)) return dir.layer
    return deriveLayerName(dir.layerRootDir, discoveryRoot, this.usedLayerNames)
  }

  private collectLocales(appConfig: I18nConfig): void {
    for (const locale of appConfig.locales) {
      if (this.seenLocaleCodes.has(locale.code)) continue
      this.seenLocaleCodes.add(locale.code)
      this.locales.push(locale)
    }
  }

  private collectLayerRoots(appConfig: I18nConfig): void {
    for (const rootDir of appConfig.layerRootDirs) {
      if (!this.layerRootDirs.includes(rootDir)) this.layerRootDirs.push(rootDir)
    }
  }

  private collectApps(appConfig: I18nConfig, renamedLayers: Map<string, string>): void {
    for (const app of appConfig.apps) {
      this.apps.push({ ...app, layers: app.layers.map(name => renamedLayers.get(name) ?? name) })
    }
  }
}
