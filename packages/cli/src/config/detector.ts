import type { I18nConfig } from './types'
import { registerAdapter, detectFramework } from '../adapters/registry'
import { NuxtAdapter } from '../adapters/nuxt/index'
import { LaravelAdapter } from '../adapters/laravel/index'
import { GenericAdapter } from '../adapters/generic/index'
import { VueAdapter } from '../adapters/vue/index'
import { ReactAdapter } from '../adapters/react/index'
import { loadProjectConfig } from './project-config'
import { log } from '../utils/logger'
import { canonicalPath } from './discovery'
import { cacheConfig, getCachedConfigFor } from './cache'

export { discoverNuxtApps } from './discovery'

// The cache itself lives in ./cache, which owns every memo that has to be
// forgotten together. Re-exported here because this has been its import path
// since before there was more than one thing to clear.
export { clearConfigCache, getCachedConfig } from './cache'

registerAdapter(new NuxtAdapter())
registerAdapter(new LaravelAdapter())
registerAdapter(new GenericAdapter())
registerAdapter(new VueAdapter())
registerAdapter(new ReactAdapter())

export async function detectI18nConfig(projectDir: string): Promise<I18nConfig> {
  const canonDir = canonicalPath(projectDir)
  const cached = getCachedConfigFor(canonDir)
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
  cacheConfig(canonDir, config)

  log.info(`Detected ${config.locales.length} locales, ${config.localeDirs.length} locale directories`)
  return config
}
