/**
 * Reading what a Next.js project already says about its locales.
 *
 * Three setups declare it authoritatively, and the adapter used to read none
 * of them — it took the alphabetically first file in `messages/` and called
 * that the default locale, so `{de,en,fr}.json` made German the source of
 * truth for an English project (#296).
 */
import { createRequire } from 'node:module'
import { asObject, asString, asStringArray, defaultExport, executeConfig, firstExisting, resolveStub } from './execute.js'
import { toErrorMessage } from '../../utils/errors.js'
import { log } from '../../utils/logger.js'

/** next-intl: `defineRouting({ locales, defaultLocale })`, usually re-exported as `routing`. */
const ROUTING_FILES = [
  'src/i18n/routing.ts',
  'src/i18n/routing.js',
  'i18n/routing.ts',
  'i18n/routing.js',
]

/** next-translate: a top-level `i18n.js` consumed by `nextTranslate(...)`. */
const NEXT_TRANSLATE_FILES = [
  'i18n.js',
  'i18n.ts',
  'i18n.mjs',
]

/** Pages Router: `i18n: { locales, defaultLocale }` in the Next config itself. */
const NEXT_CONFIG_FILES = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
]

export interface NextI18n {
  defaultLocale?: string
  locales?: string[]
  /** Which file this came from, for the message that explains the choice. */
  source: string
}

/**
 * The first source that yields something, in order of how specifically it is
 * about i18n: a routing file exists only to declare locales, whereas
 * `next.config` is mostly about everything else and the likeliest to throw.
 *
 * Returns null when no source could be read — every failure is a warning and a
 * fallback to directory detection, never an error.
 */
export async function readNextI18n(projectDir: string): Promise<NextI18n | null> {
  const readers = [readRouting, readNextTranslate, readNextConfig]

  for (const reader of readers) {
    const found = await reader(projectDir)
    if (found?.defaultLocale || found?.locales) {
      log.info(`Read i18n from ${found.source}: defaultLocale=${found.defaultLocale ?? '(none)'}`)
      return found
    }
  }

  return null
}

/**
 * next-intl. `defineRouting` returns the object it was handed, so the exported
 * routing object carries `locales` and `defaultLocale` verbatim — which is why
 * substituting it (only when it is missing; see `routingAlias`) cannot change
 * the answer.
 */
async function readRouting(projectDir: string): Promise<NextI18n | null> {
  const path = firstExisting(projectDir, ROUTING_FILES)
  if (!path) return null

  const module = await executeConfig(path, { alias: routingAlias(path) })
  if (!module) return null

  // `export const routing = defineRouting(...)` is what the docs show, but a
  // default export is just as valid, and both may be present.
  for (const candidate of [module.routing, defaultExport(module)]) {
    const routing = asObject(candidate)
    if (!routing) continue

    const defaultLocale = asString(routing.defaultLocale)
    const locales = asStringArray(routing.locales)
    if (defaultLocale || locales) {
      return { ...(defaultLocale ? { defaultLocale } : {}), ...(locales ? { locales } : {}), source: path }
    }
  }

  return null
}

/**
 * Substitute `defineRouting` only when the real one cannot be found from the
 * routing file's own location.
 *
 * The real package always wins where it is installed — it is the authority on
 * its own API, and a substitution that silently shadowed it would be the kind
 * of quiet divergence this whole line of work is about. The stub is purely a
 * rescue for the case where the file exists and its dependencies do not, which
 * is a fresh clone, a CI job that skipped install, or a fixture. Reading a
 * declaration should not require a `node_modules` to be present.
 */
function routingAlias(routingPath: string): Record<string, string> | undefined {
  if (resolvableFrom('next-intl/routing', routingPath)) return undefined

  const path = resolveStub('next-intl-routing')
  if (!path) return undefined

  log.debug(`next-intl is not installed for ${routingPath} — reading it with a stubbed defineRouting`)
  return { 'next-intl/routing': path }
}

/**
 * `next.config.js` may export `(phase, { defaultConfig }) => config`, sync or
 * async, which Next.js calls for you. An uncalled function is not a config, so
 * without this the `i18n` block of every project using that form is invisible.
 *
 * A function that throws yields nothing, like any other unreadable config.
 */
async function resolveConfigExport(exported: unknown, path: string): Promise<unknown> {
  if (typeof exported !== 'function') return exported

  try {
    return await (exported as (phase: string, context: unknown) => unknown)(
      'phase-production-build',
      { defaultConfig: {} },
    )
  }
  catch (error) {
    log.warn(`Could not evaluate the config function in ${path}: ${toErrorMessage(error)}`)
    return undefined
  }
}

function resolvableFrom(specifier: string, fromFile: string): boolean {
  try {
    createRequire(fromFile).resolve(specifier)
    return true
  }
  catch {
    return false
  }
}

/** next-translate's `i18n.js`, a plain object of `{ locales, defaultLocale, pages }`. */
async function readNextTranslate(projectDir: string): Promise<NextI18n | null> {
  const path = firstExisting(projectDir, NEXT_TRANSLATE_FILES)
  if (!path) return null

  const module = await executeConfig(path)
  if (!module) return null

  const config = asObject(defaultExport(module))
  if (!config) return null

  const defaultLocale = asString(config.defaultLocale)
  const locales = asStringArray(config.locales)
  if (!defaultLocale && !locales) return null

  return { ...(defaultLocale ? { defaultLocale } : {}), ...(locales ? { locales } : {}), source: path }
}

/**
 * The Pages Router's `i18n` block. Read last because this is the file most
 * likely to throw: in a real project it is wrapped in `withNextIntl(...)`,
 * `withSentryConfig(...)` and whatever else, and needs their env to run.
 */
async function readNextConfig(projectDir: string): Promise<NextI18n | null> {
  const path = firstExisting(projectDir, NEXT_CONFIG_FILES)
  if (!path) return null

  const module = await executeConfig(path)
  if (!module) return null

  const config = asObject(await resolveConfigExport(defaultExport(module), path))
  const i18n = config && asObject(config.i18n)
  if (!i18n) return null

  const defaultLocale = asString(i18n.defaultLocale)
  const locales = asStringArray(i18n.locales)
  if (!defaultLocale && !locales) return null

  return { ...(defaultLocale ? { defaultLocale } : {}), ...(locales ? { locales } : {}), source: path }
}
