import type { ScanPatternSet } from '../../patterns.js'

/**
 * Everything PHP the scanner knows, in the PHP frontend's home (#406): the
 * Laravel pattern set the fallback reads, and the PHP shape of the
 * bare-candidate net. The core imports these; it defines nothing PHP itself.
 */

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
  bareShapes: 'php',
}


/**
 * Matches PHP double-quoted interpolated strings with i18n-key shape,
 * regardless of call context — `$transKey = "api.x.{$key}"` assigned first
 * and passed to Lang::get() later must still suppress api.x.* orphans.
 * Content is restricted to key-like chars plus {$expr} / $var->prop
 * interpolations: a permissive "any double-quoted string containing $"
 * match swallows the code BETWEEN quoted strings (PHP code is full of $),
 * shifting quote parity past the real candidates.
 */
const BARE_PHP_DYNAMIC = /"((?:[\w.-]|\{\$[^}]+\}|\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*)+)"/g

export function collectBarePhpCandidates(content: string, bareDynamics: Set<string>): void {
  BARE_PHP_DYNAMIC.lastIndex = 0
  for (const match of content.matchAll(BARE_PHP_DYNAMIC)) {
    const expr = match[1]
    // The $-check keeps plain dotted strings out (BARE_DOTTED_STRING's job);
    // the dot must survive interpolation stripping so `{$a}$b` (no literal
    // key segment) does not become an everything-matches candidate.
    if (!expr?.includes('$')) continue
    const normalized = expr
      .replace(/\{\$[^}]+\}/g, '${_}')
      .replace(/\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*/g, '${_}')
    if (!normalized.replace(/\$\{_\}/g, '').includes('.')) continue
    bareDynamics.add(`\`${normalized}\``)
  }
}
