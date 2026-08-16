/**
 * Reading where a Vue project keeps its locale files, from the place it
 * already says so: `@intlify/unplugin-vue-i18n`'s `include`.
 *
 * The adapter's alternative is six candidate directories and a regex over
 * `src/i18n/index.ts` looking for `messages:` — which finds nothing at all if
 * the project keeps its locales anywhere else.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { asObject, executeConfig, firstExisting, resolveStub } from './execute.js'
import { log } from '../../utils/logger.js'

/**
 * Where the stub leaves what it recorded. Spelled out rather than imported
 * from the stub: importing it would fold the stub into this bundle chunk, and
 * it has to survive the build as a standalone file to be aliased to by path.
 * A registered symbol is the same symbol in both, which is the point.
 */
const RECORDED = Symbol.for('the-i18n-kit:unplugin-vue-i18n-options')

const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
]

/** Every specifier the plugin is imported under, all pointing at the stub. */
const PLUGIN_SPECIFIERS = [
  '@intlify/unplugin-vue-i18n/vite',
  '@intlify/unplugin-vue-i18n',
  '@intlify/unplugin-vue-i18n/rollup',
  '@intlify/unplugin-vue-i18n/webpack',
]

/**
 * The directories `include` points at, or null when the config declares none,
 * cannot be read, or names paths that do not exist.
 *
 * Never throws: a `vite.config.ts` needs Vite and every plugin it imports to
 * be installed, and a project where that fails must keep working exactly as it
 * did before this could be read at all.
 */
export async function readVueI18nLocaleDirs(projectDir: string): Promise<string[] | null> {
  const path = firstExisting(projectDir, VITE_CONFIG_FILES)
  if (!path) return null

  // Answers are remembered per config file because the file itself can only be
  // executed once: Node caches an ES module by URL for the life of the
  // process, so a second read would import the cache, call no plugin, record
  // nothing, and quietly report that this project declares no locale
  // directories. Resolving the same project twice has to give the same answer.
  const remembered = answers.get(path)
  if (remembered !== undefined) return remembered

  const dirs = await readInclude(path)
  answers.set(path, dirs)
  return dirs
}

const answers = new Map<string, string[] | null>()

async function readInclude(path: string): Promise<string[] | null> {
  const globalScope = globalThis as Record<symbol, unknown>
  delete globalScope[RECORDED]

  const alias = stubAlias()
  if (!alias) return null

  const module = await executeConfig(path, { alias })
  if (!module) return null

  // `defineConfig(({ mode }) => ({ ... }))` is as common as the object form,
  // and the plugin is only constructed once the function runs.
  const exported = 'default' in module ? module.default : module
  if (typeof exported === 'function') {
    try {
      await (exported as (env: unknown) => unknown)({ command: 'build', mode: 'production', isSsrBuild: false })
    }
    catch (error) {
      log.warn(`Could not evaluate the config function in ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const options = asObject(globalScope[RECORDED])
  delete globalScope[RECORDED]
  if (!options) return null

  const dirs = includeToDirs(options.include, dirname(path))
  if (dirs.length === 0) return null

  log.info(`Read locale directories from ${path}: ${dirs.join(', ')}`)
  return dirs
}

/**
 * Turn `include` — one path or many, each usually a glob — into the existing
 * directories they live in. `resolve(__dirname, './src/locales/**')` is the
 * shape the plugin's own docs use.
 */
function includeToDirs(include: unknown, configDir: string): string[] {
  const patterns = (Array.isArray(include) ? include : [include])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const dirs: string[] = []
  for (const pattern of patterns) {
    const dir = globRoot(pattern)
    if (!dir) continue

    const full = isAbsolute(dir) ? dir : resolve(configDir, dir)
    if (!dirs.includes(full) && isDirectory(full)) dirs.push(full)
  }
  return dirs
}

/** Everything before the first glob segment: `src/locales/**\/*.json` → `src/locales`. */
function globRoot(pattern: string): string | undefined {
  const segments = pattern.split('/')
  const wildcard = segments.findIndex(s => s.includes('*') || s.includes('?') || s.includes('['))
  const kept = wildcard === -1 ? segments.slice(0, -1) : segments.slice(0, wildcard)
  return kept.length > 0 ? kept.join('/') : undefined
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  }
  catch {
    return false
  }
}

/**
 * Map every specifier the plugin is imported under onto the stub that records
 * its options. Returns null if the stub cannot be located, which leaves the
 * real plugin in place — and the real plugin tells us nothing, so the caller
 * gives up rather than executing a config for no reason.
 */
function stubAlias(): Record<string, string> | null {
  const path = resolveStub('unplugin-vue-i18n')
  if (!path) return null
  return Object.fromEntries(PLUGIN_SPECIFIERS.map(specifier => [specifier, path]))
}
