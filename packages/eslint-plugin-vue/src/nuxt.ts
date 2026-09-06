import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The `@nuxt/eslint` entry point: an addon that contributes this plugin's
 * layer-aware blocks to the config `@nuxt/eslint` generates, so `withNuxt()`
 * lints i18n with layer-correct scopes and no ESLint config written by hand.
 *
 * Opt-in by import, and that is the point of it living here. The Nuxt module
 * used to push this addon itself, so installing a build-time module quietly
 * turned on lint rules nobody had asked for — and reaching the plugin from
 * there meant resolving a package the module did not depend on. The call
 * belongs in the config where the rest of the lint setup is visible.
 */

/**
 * The addon contributes code to the *generated* config, so it only acts where
 * that config is the one being used:
 *
 * - `inject` — this app is the project root the kit config lives at (or no kit
 *   config exists). `layerAware()` runs its own detection from here, so a
 *   multi-app monorepo rooted at this app still comes out right — the factory
 *   is the monorepo-aware part.
 * - `defer` — a kit config exists *above* this app: it is a sub-app of a
 *   workspace whose root ESLint config is the real surface. Injecting here
 *   would generate blocks nobody imports at best, wrong scopes at worst.
 */
export type EslintAddonDecision = 'inject' | 'defer'

const KIT_CONFIG_NAMES = ['i18n-kit.config.ts', 'i18n-kit.config.mjs', 'i18n-kit.config.js']

/**
 * The specifier the generated config imports from. A string written into
 * generated source, resolved from the linted project — not a module this file
 * loads.
 */
const PLUGIN = '@the-i18n-kit/eslint-plugin-vue'

export function eslintAddonDecision(rootDir: string): EslintAddonDecision {
  return kitConfigAbove(rootDir) ? 'defer' : 'inject'
}

/** The unimport-style entries @nuxt/eslint's config generator consumes. */
export interface EslintConfigGenAddon {
  name: string
  getConfigs: () => { imports?: Array<{ from: string, name: string, as?: string }>, configs?: string[] } | undefined
}

export interface I18nKitEslintAddonOptions {
  /**
   * The Nuxt app the generated config belongs to. Default: `process.cwd()` —
   * where Nuxt evaluates `nuxt.config.ts` from.
   */
  rootDir?: string
  /**
   * Where the hint goes when the addon defers. Default: `console.warn`. An
   * explicit call that contributes nothing and says nothing reads as a broken
   * install, so the deferral is never silent.
   */
  onDefer?: (message: string) => void
}

export function i18nKitEslintAddon(options: I18nKitEslintAddonOptions = {}): EslintConfigGenAddon {
  const rootDir = options.rootDir ?? process.cwd()
  const onDefer = options.onDefer ?? defaultOnDefer

  return {
    name: 'the-i18n-kit',
    getConfigs() {
      if (eslintAddonDecision(rootDir) === 'defer') {
        onDefer(
          'i18n-kit: this app belongs to a workspace whose kit config lives above it — '
          + 'add the layer-aware lint at the workspace root instead: '
          + `spread \`...await layerAware()\` from ${PLUGIN} into the root ESLint config.`,
        )
        return undefined
      }
      return {
        imports: [
          { from: PLUGIN, name: 'layerAware', as: '_i18nKitLayerAware' },
          { from: PLUGIN, name: 'default', as: '_i18nKitPlugin' },
        ],
        configs: [
          `..._i18nKitPlugin.configs.recommended`,
          `...await _i18nKitLayerAware({ projectDir: ${JSON.stringify(rootDir)} })`,
        ],
      }
    },
  }
}

function defaultOnDefer(message: string): void {
  // Config generation has no logger to borrow, and nothing here runs on a
  // stdout transport, so stderr is the channel.
  // eslint-disable-next-line no-console -- see above
  console.warn(message)
}

/** A kit config strictly above this dir means a larger workspace owns linting. */
function kitConfigAbove(rootDir: string): boolean {
  let dir = dirname(rootDir)
  for (let i = 0; i < 30; i++) {
    if (KIT_CONFIG_NAMES.some(name => existsSync(join(dir, name)))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
  return false
}
