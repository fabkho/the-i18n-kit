/**
 * The hand-written configuration this module validates against what Nuxt
 * resolved.
 *
 * There are two places to write it — `.i18n-mcp.json` and `i18n-kit.config.*`
 * — and the CLI reads both, so a check that reads one of them declares half a
 * rule. The typed config is the recommended one, which made it the half that
 * went unchecked (#362).
 *
 * Deliberately not the CLI's loader: depending on the CLI from a Nuxt module
 * would pull the providers and the whole scanner into every consumer's build to
 * answer which keys a file declares. Nothing here validates — the CLI owns the
 * schema, and it will report a bad config with a better message than this could.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Kept in step with the CLI's list, which is the authority on what it reads. */
const TYPED_CONFIG_FILENAMES = [
  'i18n-kit.config.ts',
  'i18n-kit.config.mts',
  'i18n-kit.config.js',
  'i18n-kit.config.mjs',
  'i18n-kit.config.cjs',
  'i18n-kit.config.cts',
] as const

const JSON_CONFIG_FILENAME = '.i18n-mcp.json'

/** A config file that exists, with the path to name it by when it is wrong. */
export interface ConfigSource {
  path: string
  config: Record<string, unknown>
}

export interface LoggerLike {
  warn: (message: string) => void
  error: (message: string) => void
  success: (message: string) => void
}

/**
 * Every hand-written config that applies to this app, nearest first.
 *
 * Each file is searched for on its own, walking up from the app — in a layered
 * repo the config sits at the root while each app builds from its own
 * directory. A file that cannot be read is reported and skipped: this module
 * exists to publish an artifact, and failing the build over a config the CLI
 * would report better is not its job.
 */
export async function readConfigSources(
  startDir: string,
  logger: LoggerLike,
): Promise<ConfigSource[]> {
  const sources = await Promise.all([
    readJsonConfig(startDir, logger),
    readTypedConfig(startDir, logger),
  ])
  return sources.filter((source): source is ConfigSource => source !== null)
}

/** `protectedLocales` from wherever it was declared, across every source. */
export function protectedLocalesFrom(sources: ConfigSource[]): string[] {
  return sources.flatMap((source) => {
    const value = source.config.protectedLocales
    return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : []
  })
}

async function readJsonConfig(startDir: string, logger: LoggerLike): Promise<ConfigSource | null> {
  const path = findUp(startDir, [JSON_CONFIG_FILENAME])
  if (!path) return null

  try {
    return { path, config: JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown> }
  }
  catch (error) {
    logger.warn(`Could not read ${path}: ${message(error)}`)
    return null
  }
}

/**
 * Load `i18n-kit.config.*` with jiti, the way the CLI does, so a TypeScript
 * config is read as it sits on disk rather than after a build.
 */
async function readTypedConfig(startDir: string, logger: LoggerLike): Promise<ConfigSource | null> {
  const path = findUp(startDir, TYPED_CONFIG_FILENAMES)
  if (!path) return null

  try {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(import.meta.url, { interopDefault: true })
    const exported = await jiti.import(path, { default: true })

    if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) {
      logger.warn(`${path} does not export a config object, so it was not checked against your Nuxt config.`)
      return null
    }

    return { path, config: exported as Record<string, unknown> }
  }
  catch (error) {
    logger.warn(`Could not read ${path}: ${message(error)}`)
    return null
  }
}

/** Nearest of `names` walking up from `startDir`, or null at the root. */
function findUp(startDir: string, names: readonly string[]): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const found = names.map(name => join(dir, name)).find(path => existsSync(path))
    if (found) return found

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
