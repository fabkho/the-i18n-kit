import type { ESLint, Linter } from 'eslint'
import literalKeyPrefix from './rules/literal-key-prefix.js'
import runtimeKeyNeedsDeclaredNamespace from './rules/runtime-key-needs-declared-namespace.js'

/**
 * Authoring rules that keep the i18n kit's scanner sound (#422), and the
 * layer-aware preset over @intlify/eslint-plugin-vue-i18n.
 *
 * Vue-only by decision. Purely additive to the scanner: the scan keeps every
 * safety net because remove-orphans must stay safe on code the lint never
 * saw — these rules shrink how much work those nets do, not whether they
 * exist.
 */
const plugin = {
  meta: {
    name: '@the-i18n-kit/eslint-plugin-vue',
  },
  rules: {
    'literal-key-prefix': literalKeyPrefix,
    'runtime-key-needs-declared-namespace': runtimeKeyNeedsDeclaredNamespace,
  },
} satisfies ESLint.Plugin

/**
 * `runtime-key` is a warning here, deliberately: the anny-ui adoption run
 * found 81 sites, dominated by option-list callbacks (`t(o.label)`) whose
 * keys the scanner's candidate net already protects — an error would teach
 * people to blanket-disable. Triage, annotate the genuinely wire-driven
 * ones, then promote per-repo (or take `strict`).
 */
const withRules = (runtimeKeySeverity: Linter.RuleSeverity, name: string): Linter.Config[] => [
  {
    name,
    files: ['**/*.vue', '**/*.ts', '**/*.js', '**/*.mjs'],
    plugins: { '@the-i18n-kit/vue': plugin },
    rules: {
      '@the-i18n-kit/vue/literal-key-prefix': 'error',
      '@the-i18n-kit/vue/runtime-key-needs-declared-namespace': runtimeKeySeverity,
    },
  },
]

const recommended = withRules('warn', '@the-i18n-kit/recommended')
const strict = withRules('error', '@the-i18n-kit/strict')

const pluginWithConfigs: ESLint.Plugin & { configs: { recommended: Linter.Config[], strict: Linter.Config[] } } = {
  ...plugin,
  configs: { recommended, strict },
}

export default pluginWithConfigs
export { layerAware } from './layer-aware.js'
export type { LayerAwareOptions, DetectedConfig } from './layer-aware.js'
