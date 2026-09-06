/**
 * Everything the process remembers about a project it has already read.
 *
 * One owner, because there is one moment that has to forget all of it: a
 * long-running MCP server clears the cache after the user edits a config file,
 * and any memo keeping its own copy would survive that and keep answering with
 * the project as it was. Memos that cannot live here register a reset instead.
 */
import type { I18nConfig } from './types.js'
import { log } from '../utils/logger.js'

const configs = new Map<string, I18nConfig>()

let lastConfig: I18nConfig | null = null

const resets: Array<() => void> = []

/**
 * Register a memo to drop whenever the config cache is cleared.
 *
 * For state derived from project files that cannot be keyed by project
 * directory — a module-level memo in a config reader, say. Anything that merely
 * costs time to recompute and cannot go stale does not belong here.
 */
export function registerCacheReset(reset: () => void): void {
  resets.push(reset)
}

/** The resolved config for a canonical project directory, if one is cached. */
export function getCachedConfigFor(canonicalDir: string): I18nConfig | undefined {
  return configs.get(canonicalDir)
}

export function cacheConfig(canonicalDir: string, config: I18nConfig): void {
  configs.set(canonicalDir, config)
  lastConfig = config
}

/** The most recently resolved config, or null when nothing has been resolved. */
export function getCachedConfig(): I18nConfig | null {
  return lastConfig
}

export function clearConfigCache(): void {
  configs.clear()
  lastConfig = null
  for (const reset of resets) reset()
  log.debug('Config cache cleared')
}
