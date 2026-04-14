import type { I18nConfig } from './types'
import { registerAdapter, detectFramework } from '../adapters/registry'
import { NuxtAdapter } from '../adapters/nuxt/index'
import { LaravelAdapter } from '../adapters/laravel/index'
import { loadProjectConfig } from './project-config'
import { log } from '../utils/logger'
import { canonicalPath } from './discovery'

export { discoverNuxtApps } from './discovery'

registerAdapter(new NuxtAdapter())
registerAdapter(new LaravelAdapter())

const configCache = new Map<string, I18nConfig>()

let lastConfig: I18nConfig | null = null

export async function detectI18nConfig(projectDir: string): Promise<I18nConfig> {
  const canonDir = canonicalPath(projectDir)
  const cached = configCache.get(canonDir)
  if (cached) {
    log.debug('Using cached i18n config')
    return cached
  }

  log.info(`Detecting i18n config from: ${projectDir}`)

  const projectConfig = await loadProjectConfig(projectDir)
  const hint = projectConfig?.framework

  const adapter = await detectFramework(projectDir, hint)
  log.info(`Detected framework: ${adapter.label}`)

  const config = await adapter.resolve(projectDir)
  config.framework = adapter.name
  configCache.set(canonDir, config)
  lastConfig = config

  log.info(`Detected ${config.locales.length} locales, ${config.localeDirs.length} locale directories`)
  return config
}

export function clearConfigCache(): void {
  configCache.clear()
  lastConfig = null
  log.debug('Config cache cleared')
}

export function getCachedConfig(): I18nConfig | null {
  return lastConfig
}
