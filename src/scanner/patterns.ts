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
   * Returns true if the callee should be skipped when the key has no dot.
   * Vue `t('word')` without a dot is likely not i18n — `emit`, `import`, etc.
   */
  requiresDotForCallee?: (callee: string) => boolean
}

// ─── Vue / Nuxt Patterns ────────────────────────────────────────

/**
 * Matches static i18n calls: $t('key'), t('key'), this.$t('key'), and double-quote variants.
 * Group 1: callee ($t | t | this.$t)
 * Group 2: quote character
 * Group 3: the key string
 */
const VUE_STATIC_KEY = /(?<!\w)(this\.\$t|\$t|\bt)\s*\(\s*(['"])((?:(?!\2).)*)\2/g

/**
 * Matches dynamic i18n calls with template literals: $t(`prefix.${var}`), t(`...`), this.$t(`...`)
 * Group 1: callee
 * Group 2: template literal content (without backticks)
 */
const VUE_DYNAMIC_KEY = /(?<!\w)(this\.\$t|\$t|\bt)\s*\(\s*`((?:[^`]|\\.)*)`/g

/**
 * Matches concatenation-based dynamic keys: t('prefix.' + var), $t("key." + expr)
 * Group 1: callee
 * Group 2: quote character
 * Group 3: the static prefix string
 */
const VUE_CONCAT_KEY = /(?<!\w)(this\.\$t|\$t|\bt)\s*\(\s*(['"])((?:(?!\2).)*)\2\s*\+/g

export const VUE_NUXT_PATTERNS: ScanPatternSet = {
  label: 'Vue / Nuxt',
  filePatterns: ['**/*.vue', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.mts'],
  ignoreDirs: ['node_modules', '.nuxt', '.output', 'dist', '.git', 'coverage', '.tmp'],
  staticKeyPatterns: [VUE_STATIC_KEY],
  dynamicKeyPatterns: [VUE_DYNAMIC_KEY],
  concatKeyPatterns: [VUE_CONCAT_KEY],
  requiresDotForCallee: (callee: string) => callee === 't',
}

// ─── Laravel / PHP Patterns ─────────────────────────────────────

/**
 * Matches Laravel static translation calls with single or double quotes:
 *   __('key')           → Group 1: __      Group 2: '  Group 3: key
 *   trans('key')        → Group 1: trans   Group 2: '  Group 3: key
 *   trans_choice('k',n) → Group 1: trans_choice  Group 2: '  Group 3: k
 *   Lang::get('key')    → Group 1: Lang::get     Group 2: '  Group 3: key
 *   @lang('key')        → Group 1: @lang         Group 2: '  Group 3: key
 */
const LARAVEL_STATIC_KEY = /(?<!\w)(__|\btrans_choice|\btrans|Lang::get|@lang)\s*\(\s*(['"])((?:(?!\2).)*)\2/g

/**
 * Matches Laravel dynamic calls with PHP variable interpolation in double-quoted strings:
 *   __("prefix.{$var}.suffix") — PHP interpolation only works in double quotes
 * Group 1: callee
 * Group 2: the string content (may contain {$var} or $var)
 */
const LARAVEL_DYNAMIC_KEY = /(?<!\w)(__|\btrans_choice|\btrans|Lang::get|@lang)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g

/**
 * Matches Laravel concatenation-based dynamic keys:
 *   __('prefix.' . $var)   → PHP concat operator is `.`
 *   trans('key.' . $expr)
 * Group 1: callee
 * Group 2: quote character
 * Group 3: the static prefix string
 */
const LARAVEL_CONCAT_KEY = /(?<!\w)(__|\btrans_choice|\btrans|Lang::get|@lang)\s*\(\s*(['"])((?:(?!\2).)*)\2\s*\./g

export const LARAVEL_PATTERNS: ScanPatternSet = {
  label: 'Laravel',
  filePatterns: ['**/*.blade.php', '**/*.php'],
  ignoreDirs: ['vendor', 'storage', 'bootstrap/cache', 'node_modules', '.git', 'dist', 'coverage'],
  staticKeyPatterns: [LARAVEL_STATIC_KEY],
  dynamicKeyPatterns: [LARAVEL_DYNAMIC_KEY],
  concatKeyPatterns: [LARAVEL_CONCAT_KEY],
}

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
