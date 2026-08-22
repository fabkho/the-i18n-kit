import type { LocaleFileFormat } from '../adapters/types.js'

// ─── Types ──────────────────────────────────────────────────────

export interface ScanPatternSet {
  label: string
  filePatterns: string[]
  ignoreDirs: string[]
  /** Must capture: (1) callee, (2) quote char, (3) key */
  staticKeyPatterns: RegExp[]
  /** Must capture: (1) callee, (2) template content */
  dynamicKeyPatterns: RegExp[]
  /** Must capture: (1) callee, (2) quote char, (3) prefix */
  concatKeyPatterns: RegExp[]
  /**
   * Language family for the context-free bare-candidate collectors (#288).
   * 'js' (default) runs the template-literal and `+`-concat shapes; 'php'
   * runs the double-quoted `{$var}` interpolation shape instead. Ungated,
   * the PHP shape matches Vue template attributes (`v-if="$slots.header"`),
   * producing `${_}.header`-class candidates that suppress every key ending
   * in those segments. Language-neutral shapes (dotted literals,
   * trailing-dot prefixes) always run.
   */
  bareShapes?: 'js' | 'php'
}

// ─── Vue / Nuxt Patterns ────────────────────────────────────────

/**
 * Matches static i18n calls: $t('key'), t('key'), this.$t('key'), $te('key'), this.$te('key'), and double-quote variants.
 * Group 1: callee ($t | t | this.$t | $te | this.$te)
 * Group 2: quote character
 * Group 3: the key string
 */
const VUE_STATIC_KEY = /(?<!\w)(this\.\$te?|\$te?|\bt)\s*\(\s*(['"])((?:(?!\2).)*)\2/g

/**
 * Matches dynamic i18n calls with template literals: $t(`prefix.${var}`), t(`...`), this.$t(`...`), $te(`...`), this.$te(`...`)
 * Group 1: callee
 * Group 2: template literal content (without backticks)
 */
const VUE_DYNAMIC_KEY = /(?<!\w)(this\.\$te?|\$te?|\bt)\s*\(\s*`((?:[^`]|\\.)*)`/g

/**
 * Matches concatenation-based dynamic keys: t('prefix.' + var), $t("key." + expr), $te('prefix.' + var), this.$te("key." + expr)
 * Group 1: callee
 * Group 2: quote character
 * Group 3: the static prefix string
 */
const VUE_CONCAT_KEY = /(?<!\w)(this\.\$te?|\$te?|\bt)\s*\(\s*(['"])((?:(?!\2).)*)\2\s*\+/g

export const VUE_NUXT_PATTERNS: ScanPatternSet = {
  label: 'Vue / Nuxt',
  filePatterns: ['**/*.vue', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.mts'],
  ignoreDirs: ['node_modules', '.nuxt', '.output', 'dist', '.git', 'coverage', '.tmp'],
  staticKeyPatterns: [VUE_STATIC_KEY],
  dynamicKeyPatterns: [VUE_DYNAMIC_KEY],
  concatKeyPatterns: [VUE_CONCAT_KEY],
  bareShapes: 'js',
}

// ─── Laravel / PHP Patterns ─────────────────────────────────────

// Defined with the PHP frontend (#406); re-exported here so the public
// surface and getPatternSet stay where they always were.
export { LARAVEL_PATTERNS } from './frontends/php/patterns.js'
import { LARAVEL_PATTERNS } from './frontends/php/patterns.js'

// ─── Resolution ─────────────────────────────────────────────────

/**
 * Maps locale file format to the appropriate scan pattern set.
 * 'php-array' → Laravel (PHP translation helpers in Blade/PHP files).
 * 'json' / undefined → Vue/Nuxt ($t / t calls in Vue/TS/JS files).
 */
export function getPatternSet(format?: LocaleFileFormat): ScanPatternSet {
  switch (format) {
    case 'php-array':
      return LARAVEL_PATTERNS
    default:
      return VUE_NUXT_PATTERNS
  }
}
