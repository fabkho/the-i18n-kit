/**
 * Loading `i18n-kit.config.ts` — the same configuration `.i18n-mcp.json`
 * carries, written in TypeScript so the editor checks it.
 *
 * Read with no build step, which is the whole point: a `protectedLocales` entry
 * that only takes effect once something has been built is a locale that quietly
 * goes unprotected in a fresh checkout. Everything here runs off the source
 * file as it sits on disk.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectConfig } from './types.js'
import { validateProjectConfig } from './schema.js'
import { ConfigError, toErrorMessage } from '../utils/errors.js'
import { log } from '../utils/logger.js'

/**
 * Candidate names, in the order a directory is searched. `.ts` first because
 * it is the one worth having; the rest exist so a JavaScript project is not
 * told to adopt TypeScript to get a typed config.
 */
const TYPED_CONFIG_FILENAMES = [
  'i18n-kit.config.ts',
  'i18n-kit.config.mts',
  'i18n-kit.config.js',
  'i18n-kit.config.mjs',
  'i18n-kit.config.cjs',
] as const

/**
 * Walk up from `startDir` for the nearest `i18n-kit.config.*`, the same way
 * `findConfigFile` looks for `.i18n-mcp.json`. Both stop at the first
 * directory that has one, so a config in an app directory shadows one in the
 * repository root rather than merging with it.
 */
export function findTypedConfigFile(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const found = TYPED_CONFIG_FILENAMES
      .map(name => join(dir, name))
      .filter(path => existsSync(path))

    if (found[0]) {
      if (found.length > 1) {
        log.warn(
          `Several i18n-kit configs in ${dir} (${found.map(p => p.slice(dir.length + 1)).join(', ')}). `
          + `Using ${found[0].slice(dir.length + 1)} — delete the others, they are being ignored.`,
        )
      }
      return found[0]
    }

    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return null
}

/**
 * Load and validate the nearest typed config, or null when there isn't one.
 *
 * Throws, unlike the framework-config readers this issue also adds. Those read
 * a file someone wrote for another tool, so failing to read it means falling
 * back to a guess. This file exists only for the kit: if it throws, or declares
 * a key that does not exist, carrying on without it is precisely the silent
 * non-application the typed config was added to prevent.
 */
export async function loadTypedConfig(
  projectDir: string,
): Promise<{ path: string, config: ProjectConfig } | null> {
  const path = findTypedConfigFile(projectDir)
  if (!path) {
    log.debug(`No i18n-kit.config.* found in ${projectDir} or any parent directory — skipping`)
    return null
  }

  log.info(`Found typed project config: ${path}`)

  let module: unknown
  try {
    const { createJiti } = await import('jiti')
    // interopDefault stays off so that a file with only named exports is
    // distinguishable from one with a default: with the interop on, the whole
    // namespace comes back and the schema rejects it as a config full of
    // unknown keys, which explains nothing.
    const jiti = createJiti(import.meta.url, {
      interopDefault: false,
      alias: selfAlias(),
    })
    module = await jiti.import(path)
  }
  catch (error) {
    throw new ConfigError(
      `Failed to load ${path}: ${toErrorMessage(error)}`,
    )
  }

  if (module === null || typeof module !== 'object' || !('default' in module)) {
    throw new ConfigError(
      `${path} must export its config as the default export — `
      + 'write `export default defineI18nKitConfig({ ... })`.',
    )
  }

  const exported = (module as { default: unknown }).default

  if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) {
    throw new ConfigError(
      `${path} must export a config object as its default export — got ${describe(exported)}. `
      + 'Wrap it in defineI18nKitConfig() from "the-i18n-cli/config".',
    )
  }

  const result = validateProjectConfig(exported)
  if (!result.ok) {
    throw new ConfigError(`Invalid ${path}:\n${result.error}`)
  }

  return { path, config: result.data }
}

/**
 * Point `the-i18n-cli/config` at the copy of `defineI18nKitConfig` that is
 * already running.
 *
 * A config file imports it for the types, and types only need the package
 * installed at author time — but the CLI is often run through `npx` in a
 * project that never added it as a dependency, where a bare import would be
 * unresolvable and take the whole config down with it. Resolving it to
 * ourselves costs nothing and is the same function either way: identity.
 *
 * Returns no alias when the entry cannot be located, which leaves normal
 * resolution to find the installed package.
 */
function selfAlias(): Record<string, string> {
  // `./` when running from the bundle, where define-config.js sits beside the
  // chunk this code ends up in; `../` when running from source, as tests do.
  for (const candidate of ['./define-config.js', '../define-config.js', '../define-config.ts']) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(path)) return { 'the-i18n-cli/config': path }
  }
  return {}
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'function') return 'a function (call defineI18nKitConfig, do not pass it)'
  return typeof value
}
