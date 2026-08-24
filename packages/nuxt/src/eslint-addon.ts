import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The zero-config ESLint path (#424): when @nuxt/eslint generates its config,
 * contribute the kit's layer-aware blocks so `withNuxt()` contains layer-correct
 * i18n linting with nothing written by hand.
 *
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
 * - `skip` — the plugin package or the intlify peer is not installed. Silent:
 *   not adopting the lint surface is not an error.
 */
export type EslintAddonDecision = 'inject' | 'defer' | 'skip'

const KIT_CONFIG_NAMES = ['i18n-kit.config.ts', 'i18n-kit.config.mjs', 'i18n-kit.config.js']

export function eslintAddonDecision(rootDir: string): EslintAddonDecision {
  if (!resolvable('@the-i18n-kit/eslint-plugin-vue', rootDir) || !resolvable('@intlify/eslint-plugin-vue-i18n', rootDir)) {
    return 'skip'
  }
  return kitConfigAbove(rootDir) ? 'defer' : 'inject'
}

/** The unimport-style entries @nuxt/eslint's config generator consumes. */
export interface EslintConfigGenAddon {
  name: string
  getConfigs: () => { imports?: Array<{ from: string, name: string, as?: string }>, configs?: string[] } | undefined
}

export function i18nKitEslintAddon(rootDir: string, onDefer: (message: string) => void): EslintConfigGenAddon {
  return {
    name: 'the-i18n-kit',
    getConfigs() {
      const decision = eslintAddonDecision(rootDir)
      if (decision === 'skip') return undefined
      if (decision === 'defer') {
        onDefer(
          'i18n-kit: this app belongs to a workspace whose kit config lives above it — '
          + 'add the layer-aware lint at the workspace root instead: '
          + 'spread `...await layerAware()` from @the-i18n-kit/eslint-plugin-vue into the root ESLint config.',
        )
        return undefined
      }
      return {
        imports: [
          { from: '@the-i18n-kit/eslint-plugin-vue', name: 'layerAware', as: '_i18nKitLayerAware' },
          { from: '@the-i18n-kit/eslint-plugin-vue', name: 'default', as: '_i18nKitPlugin' },
        ],
        configs: [
          `..._i18nKitPlugin.configs.recommended`,
          `...await _i18nKitLayerAware({ projectDir: ${JSON.stringify(rootDir)} })`,
        ],
      }
    },
  }
}

/**
 * `require.resolve` refuses ESM-only packages, and the plugin is one — walk
 * node_modules by hand instead. Presence of the package directory is the
 * question here, not loadability.
 */
function resolvable(id: string, fromDir: string): boolean {
  let dir = fromDir
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(dir, 'node_modules', id, 'package.json'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
  return false
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
