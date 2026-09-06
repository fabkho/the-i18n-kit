/**
 * Placeholder and plural-variant parity between a source string and its
 * translations. Pure — no config loading, no IO, no logging — so it stays
 * cheap to call per key and easy to extend with further message-format rules.
 */

import type { LocaleFileFormat } from '../../adapters/types.js'

import type { PlaceholderValidationResult } from '../types.js'

function extractPlaceholders(value: string, format?: LocaleFileFormat): string[] {
  const placeholders = new Set<string>()

  if (format === 'php-array') {
    for (const match of value.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) {
      placeholders.add(`:${match[1]}`)
    }
  } else {
    for (const match of value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      placeholders.add(`{${match[1]}}`)
    }
    for (const match of value.matchAll(/@:([A-Za-z0-9_.-]+)/g)) {
      placeholders.add(`@:${match[1]}`)
    }
  }

  return [...placeholders].sort()
}

/** vue-i18n plural variant separator: space-pipe-space. A bare `|` inside a
 *  word (e.g. "A|B") is NOT a plural separator. */
const PLURAL_SEPARATOR = ' | '

/** Split a vue-i18n message into plural variants. Only meaningful for the
 *  json/vue format — PHP-style messages have no pipe plurals. */
function splitPluralVariants(value: string): string[] {
  return value.split(PLURAL_SEPARATOR)
}

function diffPlaceholders(
  sourcePlaceholders: string[],
  targetValue: string,
  format?: LocaleFileFormat,
): { missing: string[], extra: string[] } {
  const sourceSet = new Set(sourcePlaceholders)
  const targetSet = new Set(extractPlaceholders(targetValue, format))
  return {
    missing: sourcePlaceholders.filter(placeholder => !targetSet.has(placeholder)),
    extra: [...targetSet].filter(placeholder => !sourceSet.has(placeholder)).sort(),
  }
}

export function validatePlaceholders(
  key: string,
  sourceValue: string,
  values: Array<{ locale: string, value: string }>,
  format?: LocaleFileFormat,
): PlaceholderValidationResult {
  const sourcePlaceholders = extractPlaceholders(sourceValue, format)
  const errors: PlaceholderValidationResult['errors'] = []

  // Per-variant validation only applies to vue-i18n pipe plurals (json/vue
  // format). PHP arrays have no pipe plural convention.
  const sourceVariants = format === 'php-array' ? [sourceValue] : splitPluralVariants(sourceValue)
  const isPlural = sourceVariants.length > 1

  for (const { locale, value } of values) {
    if (isPlural) {
      const targetVariants = splitPluralVariants(value)
      if (targetVariants.length !== sourceVariants.length) {
        errors.push({
          locale,
          key,
          missing: [],
          extra: [],
          kind: 'plural-count',
          sourceVariants: sourceVariants.length,
          targetVariants: targetVariants.length,
        })
        continue
      }
      // Each variant's placeholder set must match its source counterpart —
      // a whole-value set comparison lets a variant drop {count} while
      // another keeps it.
      const missing = new Set<string>()
      const extra = new Set<string>()
      for (const [index, sourceVariant] of sourceVariants.entries()) {
        const targetVariant = targetVariants[index]
        if (targetVariant === undefined) continue
        const variantPlaceholders = extractPlaceholders(sourceVariant, format)
        const diff = diffPlaceholders(variantPlaceholders, targetVariant, format)
        for (const placeholder of diff.missing) missing.add(placeholder)
        for (const placeholder of diff.extra) extra.add(placeholder)
      }
      if (missing.size || extra.size) {
        errors.push({ locale, key, missing: [...missing].sort(), extra: [...extra].sort(), kind: 'placeholder' })
      }
    } else {
      const { missing, extra } = diffPlaceholders(sourcePlaceholders, value, format)
      if (missing.length || extra.length) {
        errors.push({ locale, key, missing, extra, kind: 'placeholder' })
      }
    }
  }

  return {
    ok: errors.length === 0,
    placeholders: sourcePlaceholders,
    errors,
  }
}

/** Map a validation issue to the translate fail reason it represents. */
export function failReasonForIssue(issue: PlaceholderValidationResult['errors'][number]): 'placeholder-mismatch' | 'plural-mismatch' {
  return issue.kind === 'plural-count' ? 'plural-mismatch' : 'placeholder-mismatch'
}

export function mergePlaceholderValidation(
  validations: PlaceholderValidationResult[],
): PlaceholderValidationResult | undefined {
  if (validations.length === 0) return undefined
  const placeholders = [...new Set(validations.flatMap(validation => validation.placeholders))].sort()
  const errors = validations.flatMap(validation => validation.errors)
  return { ok: errors.length === 0, placeholders, errors }
}
