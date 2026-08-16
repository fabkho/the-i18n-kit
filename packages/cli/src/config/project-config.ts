import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ProjectConfig } from './types.js'
import { dropDeprecatedKeys, validateProjectConfig } from './schema.js'
import { loadTypedConfig } from './typed-config.js'
import { ConfigError, toErrorMessage } from '../utils/errors.js'
import { log } from '../utils/logger.js'

export const CONFIG_FILENAME = '.i18n-mcp.json'

// The schema itself lives in ./schema.ts, shared with the typed-config loader.
// Re-exported here because this has been its import path since before there
// was a second config format.
export { validateProjectConfig } from './schema.js'

// ─── Config file discovery ──────────────────────────────────────

/**
 * Walk up the directory tree from `startDir` to find the nearest config file.
 * Returns the full path if found, null otherwise.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return null
}

/**
 * Load the project's declared configuration, from either place it can be
 * declared: `i18n-kit.config.ts` and `.i18n-mcp.json`. Both are searched from
 * projectDir upwards, the way ESLint, Prettier and tsconfig resolve configs.
 *
 * Returns null when neither exists — the case that must keep behaving exactly
 * as it did before there were two. Throws ConfigError when either file is
 * present but unusable, or when the two disagree.
 *
 * Every adapter funnels through here, which is what makes the typed config
 * work for all of them rather than for whichever one was taught about it.
 */
export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const [json, typed] = await Promise.all([
    loadJsonConfig(projectDir),
    loadTypedConfig(projectDir),
  ])

  if (!typed) return json?.config ?? null
  if (!json) return typed.config

  const conflicts = conflictingKeys(typed.config, json.config)
  if (conflicts.length > 0) {
    throw new ConfigError(
      `${conflicts.join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} declared in both\n`
      + `  ${typed.path}\n`
      + `  ${json.path}\n`
      + 'Neither wins — a reader cannot tell which one took effect. '
      + 'Delete the duplicate from one of them.',
    )
  }

  // Disjoint by the check above, so the spread order only decides where
  // untouched keys come from, not who wins.
  return { ...json.config, ...typed.config }
}

/** Keys present in both files, ignoring the JSON-only `$schema`. */
function conflictingKeys(typed: ProjectConfig, json: ProjectConfig): string[] {
  const a = typed as Record<string, unknown>
  const b = json as Record<string, unknown>
  return Object.keys(a).filter(key => key !== '$schema' && a[key] !== undefined && b[key] !== undefined)
}

/**
 * Load the optional `.i18n-mcp.json`, with the path it was found at.
 * Returns null if no config file is found in any ancestor.
 * Throws ConfigError if a file is found but is invalid.
 */
async function loadJsonConfig(
  projectDir: string,
): Promise<{ path: string, config: ProjectConfig } | null> {
  log.debug(`Searching for ${CONFIG_FILENAME} starting from: ${projectDir}`)

  const configPath = findConfigFile(projectDir)

  if (!configPath) {
    log.info(`No ${CONFIG_FILENAME} found in ${projectDir} or any parent directory — skipping`)
    return null
  }

  log.info(`Found project config: ${configPath}`)

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    throw new ConfigError(
      `Failed to read ${CONFIG_FILENAME}: ${toErrorMessage(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ConfigError(
      `Invalid JSON in ${CONFIG_FILENAME}: ${toErrorMessage(error)}`,
    )
  }

  const result = validateProjectConfig(parsed)

  if (!result.ok) {
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}:\n${result.error}`)
  }

  log.debug(`Project config loaded successfully from ${configPath}`)

  return { path: configPath, config: dropDeprecatedKeys(result.data, CONFIG_FILENAME) }
}
