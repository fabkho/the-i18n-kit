/**
 * Mutating operations: write/add/update/remove/rename translation keys and
 * scaffold locale files.
 */

import { detectI18nConfig } from '../config/detector.js'
import type { I18nConfig, LocaleDefinition } from '../config/types.js'
import { readLocaleData, readLocaleDataIfPresent, mutateLocaleData } from '../io/locale-data.js'
import {
  getNestedValue,
  setNestedValue,
  hasNestedKey,
  removeNestedValue,
  renameNestedKey,
  validateTranslationValue,
} from '../io/key-operations.js'
import { toRelativePath } from '../scanner/code-scanner.js'
import { log } from '../utils/logger.js'
import { ToolError } from '../utils/errors.js'
import { scaffoldLocale } from '../tools/scaffold-locale.js'

import type {
  MutationResult,
  AddTranslationsResult,
  WriteTranslationsResult,
  UpdateTranslationsResult,
  ScaffoldLocaleResult,
  ScaffoldLocaleFileInfo,
  PlaceholderValidationResult,
  UnresolvedLocaleRef,
} from './types.js'
import { findWritableLayerOrThrow, findLocaleImpl, findLocaleSuggestion, resolveLocaleRef } from './shared.js'
import type { LocaleRefAmbiguity } from './shared.js'
import { validatePlaceholders, mergePlaceholderValidation } from './ops-translate.js'

/**
 * Shared logic for write_translations (supports add, update, and upsert modes).
 */
async function applyTranslations(
  config: I18nConfig,
  layer: string,
  translations: Record<string, Record<string, string>>,
  mode: 'add' | 'update' | 'upsert',
  findLocale: (config: I18nConfig, ref: string) => LocaleDefinition | undefined,
  dryRun = false,
): Promise<MutationResult> {
  const applied: string[] = []
  const skipped: string[] = []
  const warnings: string[] = []
  const unresolved = new Map<string, UnresolvedLocaleRef>()
  const ambiguities = new Map<string, LocaleRefAmbiguity>()
  const filesWritten = new Set<string>()
  const preview: Array<{ locale: string; key: string; value: string }> = []

  const byLocale = new Map<LocaleDefinition, Array<{ key: string; value: string }>>()
  const placeholderValidations: PlaceholderValidationResult[] = []

  for (const [key, localeValues] of Object.entries(translations)) {
    const entries = Object.entries(localeValues)
    const sourceEntry = entries.find(([localeRef]) => {
      const locale = findLocale(config, localeRef)
      return locale?.code === config.defaultLocale
    }) ?? entries[0]
    if (sourceEntry) {
      placeholderValidations.push(validatePlaceholders(
        key,
        sourceEntry[1],
        entries.map(([localeRef, value]) => ({ locale: localeRef, value })),
        config.localeFileFormat,
      ))
    }

    for (const [localeRef, value] of Object.entries(localeValues)) {
      if (mode === 'add') {
        const warning = validateTranslationValue(value)
        if (warning) {
          warnings.push(`${key} (${localeRef}): ${warning}`)
        }
      }
      const { locale, ambiguity } = resolveLocaleRef(config, localeRef)
      if (ambiguity && !ambiguities.has(localeRef)) {
        ambiguities.set(localeRef, ambiguity)
        log.warn(
          `Locale ref "${localeRef}" matches ${ambiguity.candidates.length} locales by ${ambiguity.matchedBy} `
          + `(${ambiguity.candidates.join(', ')}) — using "${ambiguity.resolvedTo}". Use a locale code to be explicit.`,
        )
      }
      if (!locale) {
        // stderr alone is invisible to an MCP caller, and the key still lands
        // in `applied` via the other locales — so the result must carry this
        // or the write reads as a clean success (#301).
        const suggestion = findLocaleSuggestion(config, localeRef)
        log.warn(`Locale not found: ${localeRef}, skipping.${suggestion}`)
        const existing = unresolved.get(localeRef)
        if (existing) {
          existing.keys.push(key)
        } else {
          unresolved.set(localeRef, {
            ref: localeRef,
            keys: [key],
            ...(suggestion ? { suggestion: suggestion.trim() } : {}),
          })
        }
        continue
      }
      if (!byLocale.has(locale)) {
        byLocale.set(locale, [])
      }
      byLocale.get(locale)!.push({ key, value })
    }
  }

  for (const [locale, entries] of byLocale) {
    if (dryRun) {
      const data = await readLocaleData(config, layer, locale)
      for (const { key, value } of entries) {
        const exists = hasNestedKey(data, key)
        if (mode === 'add' && exists) {
          skipped.push(key)
        } else if (mode === 'update' && !exists) {
          skipped.push(key)
        } else {
          applied.push(key)
          preview.push({ locale: locale.code, key, value })
        }
      }
    } else {
      const written = await mutateLocaleData(config, layer, locale, (data) => {
        for (const { key, value } of entries) {
          const exists = hasNestedKey(data, key)
          if (mode === 'add' && exists) {
            skipped.push(key)
          } else if (mode === 'update' && !exists) {
            skipped.push(key)
          } else {
            setNestedValue(data, key, value)
            applied.push(key)
          }
        }
      })
      for (const f of written) filesWritten.add(f)
    }
  }

  const placeholderValidation = mergePlaceholderValidation(placeholderValidations)
  if (placeholderValidation && !placeholderValidation.ok) {
    warnings.push(...placeholderValidation.errors.map(error => error.kind === 'plural-count'
      ? `${error.key} (${error.locale}): plural variant count mismatch; expected ${error.sourceVariants}, got ${error.targetVariants}`
      : `${error.key} (${error.locale}): placeholder mismatch; missing: ${error.missing.join(', ') || '-'}; extra: ${error.extra.join(', ') || '-'}`))
  }

  // A dropped ref is a warning too, so callers that only read `warnings`
  // still see it — but it also gets its own field, because "the write silently
  // did less than you asked" is not the same class as a placeholder nit.
  for (const u of unresolved.values()) {
    warnings.push(
      `Locale "${u.ref}" matched no known locale — ${u.keys.length} key(s) not written for it.`
      + (u.suggestion ? ` ${u.suggestion}` : ''),
    )
  }

  const result: MutationResult = {
    applied: [...new Set(applied)],
    skipped: [...new Set(skipped)],
    warnings,
    filesWritten: filesWritten.size,
  }

  if (unresolved.size > 0) {
    result.unresolvedLocales = [...unresolved.values()]
  }

  if (ambiguities.size > 0) {
    result.ambiguousLocales = [...ambiguities.values()]
  }

  if (placeholderValidation) {
    result.placeholderValidation = placeholderValidation
  }

  if (dryRun) {
    result.preview = preview
  }

  return result
}

/**
 * Write translation keys to the specified layer with mode control.
 *
 * Mode:
 *   - 'upsert' (default): Adds new keys and updates existing ones. Never skips.
 *   - 'add': Only creates new keys, skipping existing ones.
 *   - 'update': Only modifies existing keys, skipping missing ones.
 */
export async function writeTranslations(opts: {
  layer: string
  translations: Record<string, Record<string, string>>
  mode?: 'add' | 'update' | 'upsert'
  dryRun?: boolean
  projectDir?: string
}): Promise<WriteTranslationsResult> {
  const { layer, translations } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const mode = opts.mode ?? 'upsert'
  const isDryRun = opts.dryRun ?? false

  const { applied, skipped, warnings, filesWritten, preview, placeholderValidation, unresolvedLocales, ambiguousLocales } = await applyTranslations(
    config, layer, translations, mode, findLocaleImpl, isDryRun,
  )

  if (isDryRun) {
    const result: WriteTranslationsResult = {
      dryRun: true,
      wouldWrite: preview,
      skipped,
      summary: {
        keysWritten: applied.length,
        keysSkipped: skipped.length,
        message: 'Call again with dryRun: false to apply these changes.',
      },
    }
    if (skipped.length > 0) { result.skippedKeys = skipped }
    if (warnings.length > 0) { result.warnings = warnings }
    if (placeholderValidation) { result.placeholderValidation = placeholderValidation }
    if (unresolvedLocales) { result.unresolvedLocales = unresolvedLocales }
    if (ambiguousLocales) { result.ambiguousLocales = ambiguousLocales }
    return result
  }

  const result: WriteTranslationsResult = {
    written: applied,
    skipped,
    filesWritten,
  }
  if (warnings.length > 0) { result.warnings = warnings }
  if (placeholderValidation) { result.placeholderValidation = placeholderValidation }
  if (unresolvedLocales) { result.unresolvedLocales = unresolvedLocales }
  if (ambiguousLocales) { result.ambiguousLocales = ambiguousLocales }
  return result
}

/**
 * Add new translation keys to the specified layer.
 *
 * @deprecated Use writeTranslations with mode: 'add' instead.
 */
export async function addTranslations(opts: {
  layer: string
  translations: Record<string, Record<string, string>>
  dryRun?: boolean
  projectDir?: string
}): Promise<AddTranslationsResult> {
  const { layer, translations } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false

  const { applied, skipped, warnings, filesWritten, preview, placeholderValidation, unresolvedLocales, ambiguousLocales } = await applyTranslations(
    config, layer, translations, 'add', findLocaleImpl, isDryRun,
  )

  if (isDryRun) {
    const result: AddTranslationsResult = {
      dryRun: true,
      wouldAdd: preview,
      skipped,
      summary: {
        keysToAdd: applied.length,
        keysSkipped: skipped.length,
        message: 'Call again with dryRun: false to apply these changes.',
      },
    }
    if (skipped.length > 0) {
      result.skippedKeys = skipped
    }
    if (warnings.length > 0) {
      result.warnings = warnings
    }
    if (placeholderValidation) {
      result.placeholderValidation = placeholderValidation
    }
    if (unresolvedLocales) { result.unresolvedLocales = unresolvedLocales }
    if (ambiguousLocales) { result.ambiguousLocales = ambiguousLocales }
    return result
  }

  const summary: AddTranslationsResult = {
    added: applied,
    skipped,
    filesWritten,
  }
  if (warnings.length > 0) {
    summary.warnings = warnings
  }
  if (placeholderValidation) {
    summary.placeholderValidation = placeholderValidation
  }
  if (unresolvedLocales) { summary.unresolvedLocales = unresolvedLocales }
  if (ambiguousLocales) { summary.ambiguousLocales = ambiguousLocales }

  return summary
}

/**
 * Update existing translation keys in the specified layer.
 *
 * @deprecated Use writeTranslations with mode: 'update' instead.
 */
export async function updateTranslations(opts: {
  layer: string
  translations: Record<string, Record<string, string>>
  dryRun?: boolean
  projectDir?: string
}): Promise<UpdateTranslationsResult> {
  const { layer, translations } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false

  const { applied, skipped, filesWritten, preview, placeholderValidation, unresolvedLocales, ambiguousLocales } = await applyTranslations(
    config, layer, translations, 'update', findLocaleImpl, isDryRun,
  )

  if (isDryRun) {
    const result: UpdateTranslationsResult = {
      dryRun: true,
      wouldUpdate: preview,
      skipped,
      summary: {
        keysToUpdate: applied.length,
        keysSkipped: skipped.length,
        message: 'Call again with dryRun: false to apply these changes.',
      },
    }
    if (skipped.length > 0) {
      result.skippedKeys = skipped
    }
    if (placeholderValidation) {
      result.placeholderValidation = placeholderValidation
    }
    if (unresolvedLocales) { result.unresolvedLocales = unresolvedLocales }
    if (ambiguousLocales) { result.ambiguousLocales = ambiguousLocales }
    return result
  }

  const result: UpdateTranslationsResult = {
    updated: applied,
    skipped,
    filesWritten,
  }
  if (placeholderValidation) {
    result.placeholderValidation = placeholderValidation
  }
  return result
}

/**
 * Remove one or more translation keys from ALL locale files in the specified layer.
 */
export async function removeTranslations(opts: {
  layer: string
  keys: string[]
  dryRun?: boolean
  projectDir?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, keys } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false

  findWritableLayerOrThrow(config, layer)

  const preview: Array<{ locale: string; key: string; oldValue: unknown }> = []
  const removed: string[] = []
  const notFound: string[] = []
  const filesWritten = new Set<string>()

  for (const locale of config.locales) {
    const data = await readLocaleDataIfPresent(config, layer, locale)
    if (!data) continue

    if (isDryRun) {
      for (const key of keys) {
        const value = getNestedValue(data, key)
        if (value !== undefined) {
          preview.push({ locale: locale.code, key, oldValue: value })
        }
      }
    } else {
      const written = await mutateLocaleData(config, layer, locale, (fileData) => {
        for (const key of keys) {
          if (removeNestedValue(fileData, key)) {
            removed.push(`${locale.code}:${key}`)
          } else {
            notFound.push(`${locale.code}:${key}`)
          }
        }
      })
      for (const f of written) filesWritten.add(f)
    }
  }

  if (isDryRun) {
    return {
      dryRun: true,
      wouldRemove: preview,
      summary: {
        keysFound: preview.length,
        message: 'Call again with dryRun: false to apply these changes.',
      },
    }
  }

  const uniqueRemoved = [...new Set(removed.map(r => r.split(':')[1]))]
  return {
    removed: uniqueRemoved,
    removedPerLocale: removed,
    notFound: [...new Set(notFound)],
    filesWritten: filesWritten.size,
  }
}

/**
 * Rename/move a translation key across ALL locale files in a layer.
 */
export async function renameTranslationKey(opts: {
  layer: string
  oldKey: string
  newKey: string
  dryRun?: boolean
  projectDir?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, oldKey, newKey } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false

  if (oldKey === newKey) {
    throw new ToolError(`Old key and new key are the same: "${oldKey}". Provide a different newKey to rename to.`, 'SAME_KEY')
  }

  findWritableLayerOrThrow(config, layer)

  const preview: Array<{ locale: string; oldKey: string; newKey: string; value: unknown }> = []
  const renamed: string[] = []
  const notFoundArr: string[] = []
  const conflicts: string[] = []
  const filesWritten = new Set<string>()

  for (const locale of config.locales) {
    const data = await readLocaleDataIfPresent(config, layer, locale)
    if (!data) continue

    const oldValue = getNestedValue(data, oldKey)
    if (oldValue === undefined) {
      notFoundArr.push(locale.code)
      continue
    }

    if (hasNestedKey(data, newKey)) {
      conflicts.push(locale.code)
      continue
    }

    if (isDryRun) {
      preview.push({ locale: locale.code, oldKey, newKey, value: oldValue })
    } else {
      const written = await mutateLocaleData(config, layer, locale, (fileData) => {
        renameNestedKey(fileData, oldKey, newKey)
      })
      renamed.push(locale.code)
      for (const f of written) filesWritten.add(f)
    }
  }

  if (isDryRun) {
    const result: Record<string, unknown> = {
      dryRun: true,
      wouldRename: preview,
      summary: {
        localesAffected: preview.length,
        message: 'Call again with dryRun: false to apply these changes.',
      },
    }
    if (notFoundArr.length > 0) {
      result.notFoundInLocales = notFoundArr
    }
    if (conflicts.length > 0) {
      result.conflictsInLocales = conflicts
      result.summary = {
        ...(result.summary as Record<string, unknown>),
        warning: `New key "${newKey}" already exists in ${conflicts.length} locale(s). These will be skipped.`,
      }
    }
    return result
  }

  const summary: Record<string, unknown> = {
    renamed,
    filesWritten: filesWritten.size,
    oldKey,
    newKey,
  }
  if (notFoundArr.length > 0) {
    summary.notFoundInLocales = notFoundArr
  }
  if (conflicts.length > 0) {
    summary.skippedDueToConflict = conflicts
  }

  return summary
}

/**
 * Create empty locale files for new languages.
 */
export async function scaffoldLocaleFiles(opts: {
  locales?: string[]
  layer?: string
  dryRun?: boolean
  projectDir?: string
}): Promise<ScaffoldLocaleResult> {
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const result = await scaffoldLocale(config, { locales: opts.locales, layer: opts.layer, dryRun: opts.dryRun })

  const toFileInfo = (f: ScaffoldLocaleFileInfo): ScaffoldLocaleFileInfo => ({
    locale: f.locale,
    layer: f.layer,
    file: toRelativePath(f.file, config.rootDir),
    keys: f.keys,
    ...(f.namespace ? { namespace: f.namespace } : {}),
  })

  return {
    created: result.created.map(toFileInfo),
    skipped: result.skipped.map(toFileInfo),
    dryRun: opts.dryRun ?? false,
  }
}
