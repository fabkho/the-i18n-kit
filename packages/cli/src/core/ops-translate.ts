/**
 * Translation operations: translate_missing and translate_key, plus the
 * prompt builders, placeholder validation, and fallback-context helpers
 * they share.
 */

import { detectI18nConfig } from '../config/detector.js'
import type { I18nConfig, LocaleDefinition, ProjectConfig } from '../config/types.js'
import type { LocaleFileFormat } from '../adapters/types.js'
import { readLocaleData, mutateLocaleData } from '../io/locale-data.js'
import {
  getNestedValue,
  setNestedValue,
  getLeafKeys,
} from '../io/key-operations.js'
import { log } from '../utils/logger.js'
import { ToolError, toErrorMessage } from '../utils/errors.js'
import { TranslateProviderError } from '../llm/providers.js'

import type {
  TranslateFn,
  ProgressFn,
  TranslateMode,
  TranslateFailReason,
  TranslateSkipReason,
  TranslateKeyLocaleIssue,
  TranslateMissingLocaleResult,
  PlaceholderValidationResult,
  TranslateKeyResult,
} from './types.js'
import { findLayerOrThrow, findLocaleImpl, findLocaleOrThrow, localeRefInfo } from './shared.js'

// ─── Shared helpers (exported for reuse) ────────────────────────

/**
 * Fixed maxTokens budget for a translate request. Deliberately independent
 * of batch size — models simply stop when the JSON object is closed.
 */
export function computeMaxTokens(_batchKeyCount: number): number {
  return 16384
}

/**
 * Total progress steps for translate_missing: per locale with missing keys,
 * one step per batch plus a start and a complete step (the +2).
 */
export function computeProgressTotal(missingKeyCounts: number[], maxBatch: number): number {
  return missingKeyCounts.reduce((sum, count) => {
    if (count <= 0) return sum
    return sum + Math.ceil(count / maxBatch) + 2
  }, 0)
}

/**
 * Resolve the config's `protectedLocales` entries (any locale ref: code,
 * language tag, or file name) against the known locales. Entries that do not
 * match a known locale are ignored with a warning. Returns the resolved
 * definitions, deduplicated by canonical code.
 */
export function resolveProtectedLocales(config: I18nConfig): LocaleDefinition[] {
  const refs = config.projectConfig?.protectedLocales ?? []
  const resolved = new Map<string, LocaleDefinition>()
  for (const ref of refs) {
    const locale = findLocaleImpl(config, ref)
    if (!locale) {
      log.warn(
        `protectedLocales entry "${ref}" does not match any known locale — ignoring. `
        + `Available: ${config.locales.map(l => l.code).join(', ')}`,
      )
      continue
    }
    if (!resolved.has(locale.code)) {
      resolved.set(locale.code, locale)
    }
  }
  return [...resolved.values()]
}

function warnProtectedOverride(code: string): void {
  log.warn(`Locale "${code}" is protected (protectedLocales) — translating anyway because it was explicitly requested via targetLocales.`)
}

/**
 * Resolve translate_missing target locales. Protected locales are excluded
 * from the DEFAULT target set (returned separately so the caller can report
 * them as skipped); naming one explicitly in targetLocales overrides the
 * protection with a warning.
 */
function resolveTranslateTargets(
  config: I18nConfig,
  refLocale: LocaleDefinition,
  requested: string[] | undefined,
): { targets: LocaleDefinition[], protectedDefaults: LocaleDefinition[] } {
  const protectedCodes = new Set(resolveProtectedLocales(config).map(l => l.code))
  if (requested) {
    const targets = requested.map((code) => {
      const loc = findLocaleImpl(config, code)
      if (!loc) {
        throw new ToolError(`Target locale not found: "${code}". Available: ${config.locales.map(l => l.code).join(', ')}. Pass valid locale codes in targetLocales.`, 'LOCALE_NOT_FOUND')
      }
      if (protectedCodes.has(loc.code)) {
        warnProtectedOverride(loc.code)
      }
      return loc
    })
    return { targets, protectedDefaults: [] }
  }
  const defaults = config.locales.filter(l => l.code !== refLocale.code)
  return {
    targets: defaults.filter(l => !protectedCodes.has(l.code)),
    protectedDefaults: defaults.filter(l => protectedCodes.has(l.code)),
  }
}

/**
 * Build result entries for protected locales withheld from the default
 * target set of translate_missing — callers see what was NOT translated
 * and the totals stay meaningful.
 */
async function collectProtectedLocaleResults(
  config: I18nConfig,
  layer: string,
  mode: TranslateMode,
  protectedDefaults: LocaleDefinition[],
  missingKeysIn: (data: Record<string, unknown>) => string[],
): Promise<Record<string, TranslateMissingLocaleResult>> {
  const results: Record<string, TranslateMissingLocaleResult> = {}
  for (const locale of protectedDefaults) {
    let data: Record<string, unknown> = {}
    try {
      data = await readLocaleData(config, layer, locale)
    } catch {}
    const missingKeys = missingKeysIn(data)
    if (missingKeys.length === 0) continue
    results[locale.code] = {
      mode,
      missing: missingKeys.length,
      translated: [],
      failed: [],
      skipped: missingKeys.map(key => ({ key, reason: 'protected-locale' as const })),
    }
  }
  return results
}

/**
 * Build the translate_key target list (deduplicated, source locale removed).
 * Protected locales are excluded from the default 'all' target set and
 * returned as skipped entries; naming one explicitly overrides the
 * protection with a warning.
 */
function partitionTranslateKeyTargets(
  config: I18nConfig,
  resolved: LocaleDefinition[],
  sourceCode: string,
  usesDefaultTargets: boolean,
): { targetLocales: LocaleDefinition[], protectedSkipped: Array<{ locale: string, reason: TranslateSkipReason }> } {
  const protectedCodes = new Set(resolveProtectedLocales(config).map(l => l.code))
  const byCode = new Map<string, LocaleDefinition>()
  const protectedSkipped: Array<{ locale: string, reason: TranslateSkipReason }> = []
  for (const locale of resolved) {
    if (locale.code === sourceCode || byCode.has(locale.code)) continue
    if (protectedCodes.has(locale.code)) {
      if (usesDefaultTargets) {
        protectedSkipped.push({ locale: locale.code, reason: 'protected-locale' })
        continue
      }
      warnProtectedOverride(locale.code)
    }
    byCode.set(locale.code, locale)
  }
  return { targetLocales: [...byCode.values()], protectedSkipped }
}

// ─── Translation prompt helpers ─────────────────────────────────

export function extractPlaceholders(value: string, format?: LocaleFileFormat): string[] {
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
function failReasonForIssue(issue: PlaceholderValidationResult['errors'][number]): 'placeholder-mismatch' | 'plural-mismatch' {
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

function placeholderInstruction(format?: LocaleFileFormat): string {
  if (format === 'php-array') {
    return 'Preserve all :placeholder parameters exactly as-is.'
  }
  return 'Preserve all {placeholder} parameters and @:linked.message references.'
}

export function buildTranslationSystemPrompt(
  projectConfig: ProjectConfig | undefined,
  targetLocaleCode: string,
  localeFileFormat?: LocaleFileFormat,
): string {
  const parts: string[] = [
    `You are a professional translator for software UI strings. ${placeholderInstruction(localeFileFormat)} Be concise — UI space is limited.`,
  ]

  if (projectConfig?.translationPrompt) {
    parts.push(projectConfig.translationPrompt)
  }

  if (projectConfig?.glossary && Object.keys(projectConfig.glossary).length > 0) {
    const glossaryLines = Object.entries(projectConfig.glossary)
      .map(([term, definition]) => `- ${term} → ${definition}`)
      .join('\n')
    parts.push(`GLOSSARY — use these terms consistently:\n${glossaryLines}`)
  }

  if (projectConfig?.localeNotes?.[targetLocaleCode]) {
    parts.push(`TARGET LOCALE NOTE (${targetLocaleCode}): ${projectConfig.localeNotes[targetLocaleCode]}`)
  }

  if (projectConfig?.examples && projectConfig.examples.length > 0) {
    const exampleLines = projectConfig.examples
      .map((ex) => {
        const pairs = Object.entries(ex)
          .filter(([k]) => k !== 'key' && k !== 'note')
          .map(([locale, val]) => `${locale}: "${val}"`)
          .join(', ')
        const note = ex.note ? ` (${ex.note})` : ''
        return `- ${ex.key}: ${pairs}${note}`
      })
      .join('\n')
    parts.push(`STYLE EXAMPLES:\n${exampleLines}`)
  }

  parts.push('Return ONLY a JSON object mapping keys to translated values. No markdown, no explanation, no code fences.')

  return parts.join('\n\n')
}

export function buildTranslationUserMessage(
  referenceLocaleCode: string,
  targetLocaleCode: string,
  keysAndValues: Record<string, string>,
  localeFileFormat?: LocaleFileFormat,
): string {
  return [
    `Translate the following i18n key-value pairs from ${referenceLocaleCode} to ${targetLocaleCode}.`,
    placeholderInstruction(localeFileFormat),
    '',
    JSON.stringify(keysAndValues),
  ].join('\n')
}

export function extractJsonFromResponse(responseText: string): Record<string, unknown> {
  const trimmed = responseText.trim()

  // Tier 1: direct parse
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {}

  // Tier 2: strip markdown code fences
  if (trimmed.startsWith('```')) {
    const stripped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    try {
      return JSON.parse(stripped) as Record<string, unknown>
    } catch {}
  }

  // Tier 3: balanced bracket extraction — find first complete {...}
  const start = trimmed.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\' && inString) {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1)
          return JSON.parse(candidate) as Record<string, unknown>
        }
      }
    }
  }

  throw new Error(`No valid JSON object found in response. Preview: ${trimmed.substring(0, 200)}`)
}

export function buildFallbackContext(
  projectConfig: ProjectConfig | undefined,
  referenceLocaleCode: string,
  targetLocaleCode: string,
  keysAndValues: Record<string, string>,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    instruction: `Translate these keys from ${referenceLocaleCode} to ${targetLocaleCode}, then call write_translations (mode: 'upsert') to write them.`,
    referenceLocale: referenceLocaleCode,
    targetLocale: targetLocaleCode,
    keysToTranslate: keysAndValues,
  }

  if (projectConfig?.translationPrompt) {
    context.translationPrompt = projectConfig.translationPrompt
  }
  if (projectConfig?.glossary && Object.keys(projectConfig.glossary).length > 0) {
    context.glossary = projectConfig.glossary
  }
  if (projectConfig?.localeNotes?.[targetLocaleCode]) {
    context.localeNote = projectConfig.localeNotes[targetLocaleCode]
  }
  if (projectConfig?.examples && projectConfig.examples.length > 0) {
    context.examples = projectConfig.examples
  }

  return context
}

// ─── Operations ─────────────────────────────────────────────────

/**
 * Find keys missing in target locales and translate them.
 *
 * When translateFn is provided, uses it to translate via LLM.
 * When translateFn is absent, returns fallback contexts for the agent.
 */
export async function translateMissing(opts: {
  layer: string
  referenceLocale?: string
  targetLocales?: string[]
  locales?: string[]
  keys?: string[]
  batchSize?: number
  dryRun?: boolean
  compact?: boolean
  projectDir?: string
  translateFn?: TranslateFn
  progressFn?: ProgressFn
  /** Called once after the pre-scan with the computed total number of progress steps. */
  onProgressTotal?: (total: number) => void
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false
  const maxBatch = opts.batchSize ?? 50
  if (!Number.isFinite(maxBatch) || maxBatch <= 0 || !Number.isInteger(maxBatch)) {
    throw new ToolError(`Invalid batchSize: ${opts.batchSize}. Must be a positive integer.`, 'INVALID_BATCH_SIZE')
  }

  const localeDir = findLayerOrThrow(config, layer)
  if (localeDir.aliasOf) {
    throw new ToolError(`Layer "${layer}" is an alias of "${localeDir.aliasOf}". Modify the source layer "${localeDir.aliasOf}" instead.`, 'LAYER_IS_ALIAS')
  }

  const refCode = opts.referenceLocale ?? config.defaultLocale
  const refLocale = findLocaleImpl(config, refCode)
  if (!refLocale) {
    throw new ToolError(`Reference locale not found: "${refCode}". Available: ${config.locales.map(l => l.code).join(', ')}. Pass a valid locale code as referenceLocale, or omit it to use the project default.`, 'REFERENCE_LOCALE_NOT_FOUND')
  }

  const refData = await readLocaleData(config, layer, refLocale)
  if (Object.keys(refData).length === 0) {
    throw new ToolError(`No locale data found for reference locale "${refCode}" in layer "${layer}". Verify the layer exists and contains data for this locale using list_locale_dirs.`, 'NO_LOCALE_FILE')
  }
  const allRefKeys = getLeafKeys(refData).filter(k => {
    const v = getNestedValue(refData, k)
    return typeof v === 'string' ? v.length > 0 : v !== null && v !== undefined
  })

  const resolvedTargetLocales = opts.targetLocales ?? opts.locales
  const { targets, protectedDefaults } = resolveTranslateTargets(config, refLocale, resolvedTargetLocales)

  const mode: TranslateMode = isDryRun ? 'dry-run' : opts.translateFn ? 'provider' : 'agent'
  const reportProgress = opts.progressFn ?? (async () => {})

  function isKeyMissingIn(data: Record<string, unknown>, k: string): boolean {
    const v = getNestedValue(data, k)
    return v === undefined || v === '' || v === null
  }

  /** The keys missing in a target locale's data (scoped to opts.keys when given). */
  function missingKeysIn(data: Record<string, unknown>): string[] {
    const isMissing = (k: string) => isKeyMissingIn(data, k)
    return opts.keys
      ? opts.keys.filter(k => isMissing(k) && allRefKeys.includes(k))
      : allRefKeys.filter(k => isMissing(k))
  }

  // Pre-scan: count missing keys per target to compute progressTotal
  if (opts.onProgressTotal) {
    const preScanCounts: number[] = []
    for (const target of targets) {
      let scanData: Record<string, unknown> = {}
      try {
        scanData = await readLocaleData(config, layer, target)
      } catch {}
      preScanCounts.push(missingKeysIn(scanData).length)
    }
    // In dry-run or agent mode, only 2 steps per locale (start + complete),
    // no batch steps. Full batching only in provider mode.
    const willBatch = mode === 'provider'
    const total = willBatch
      ? computeProgressTotal(preScanCounts, maxBatch)
      : preScanCounts.filter(c => c > 0).length * 2
    opts.onProgressTotal(total)
  }

  const results: Record<string, TranslateMissingLocaleResult> = {}
  const fallbackContexts: Record<string, Record<string, unknown>> = {}

  // Pre-read all target locale data for missing key detection
  const targetDataCache = new Map<string, Record<string, unknown>>()
  for (const target of targets) {
    let targetData: Record<string, unknown> = {}
    try {
      targetData = await readLocaleData(config, layer, target)
    } catch {}
    targetDataCache.set(target.code, targetData)
  }

  // Set when any locale hits an auth error: the run is doomed, so sibling
  // locales must stop issuing provider requests and must not write output
  // after the abort. Locales that fully completed before the abort keep
  // their writes — translateMissing is idempotent (re-runs only fill the
  // still-missing keys), so completed work is never wasted or wrong.
  const runState = { aborted: false }

  async function translateOneLocale(
    target: LocaleDefinition,
    targetData: Record<string, unknown>,
  ): Promise<{ result: TranslateMissingLocaleResult, fallbackContext?: Record<string, unknown> }> {
    const missingKeys = missingKeysIn(targetData)

    if (missingKeys.length === 0) {
      return { result: { mode, missing: 0, translated: [], failed: [], skipped: [] } }
    }

    await reportProgress(`Starting ${target.code}: ${missingKeys.length} missing keys`)

    const keysAndValues: Record<string, string> = {}
    for (const key of missingKeys) {
      const value = getNestedValue(refData, key)
      if (typeof value === 'string') {
        keysAndValues[key] = value
      }
    }
    const missing = Object.keys(keysAndValues).length

    if (isDryRun) {
      await reportProgress(`Complete ${target.code} (dry run)`)
      return { result: { mode: 'dry-run', missing, translated: [], wouldTranslate: Object.keys(keysAndValues), failed: [], skipped: [] } }
    }

    if (opts.translateFn) {
      const translated: string[] = []
      const failed: Array<{ key: string, reason: TranslateFailReason }> = []
      const keyEntries = Object.entries(keysAndValues)
      const allTranslations: Record<string, string> = {}
      const totalBatches = Math.ceil(keyEntries.length / maxBatch)
      let model: string | undefined

      for (let i = 0; i < keyEntries.length; i += maxBatch) {
        if (runState.aborted) break
        const batchNum = Math.floor(i / maxBatch) + 1
        const batch = Object.fromEntries(keyEntries.slice(i, i + maxBatch))
        let batchTranslations: Record<string, string> | null = null
        let batchTruncated = false

        const systemPrompt = buildTranslationSystemPrompt(config.projectConfig, target.language || target.code, config.localeFileFormat)
        const userMessage = buildTranslationUserMessage(
          refLocale!.language || refLocale!.code,
          target.language || target.code,
          batch,
          config.localeFileFormat,
        )

        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) {
            const delayMs = 2000 * 2 ** attempt
            await new Promise(r => setTimeout(r, delayMs))
          }
          if (runState.aborted) break
          try {
            const response = await opts.translateFn({
              systemPrompt,
              userMessage,
              maxTokens: computeMaxTokens(Object.keys(batch).length),
            })

            model = response.model
            log.info(`Translation model: ${response.model}`)

            if (response.truncated) {
              // The batch response was cut off at the token limit — retrying
              // with the same budget would truncate again, so fail fast.
              batchTruncated = true
              log.warn(`Translate response truncated for batch ${batchNum} in ${target.code}: provider hit the token limit. Reduce batchSize.`)
              break
            }
            if (response.text.trim() === '') {
              throw new TranslateProviderError('Provider returned an empty response', 'provider')
            }

            const parsed = extractJsonFromResponse(response.text)
            const batchKeys = new Set(Object.keys(batch))
            batchTranslations = {} as Record<string, string>
            for (const [key, value] of Object.entries(parsed)) {
              if (batchKeys.has(key) && typeof value === 'string') {
                batchTranslations[key] = value
              }
            }
            break
          } catch (_error) {
            if (_error instanceof TranslateProviderError && _error.kind === 'auth') {
              // Auth failures affect every request — abort the whole run
              // instead of failing key by key through retries.
              runState.aborted = true
              throw new ToolError(
                `Provider authentication failed: ${_error.message}. Verify your API key (config apiKey or the provider's environment variable).`,
                'PROVIDER_AUTH_ERROR',
              )
            }
            const errMsg = _error instanceof Error ? _error.message : String(_error)
            if (attempt === 0) {
              log.warn(`Translate request failed for batch ${batchNum} in ${target.code}: ${errMsg}. Retrying (attempt 2)`)
            } else {
              log.warn(`Translate retry failed for batch ${batchNum} in ${target.code}: ${errMsg}`)
            }
          }
        }

        // Account for every batch key: translated, omitted by the model,
        // or lost to a failed batch — totals must always reconcile.
        for (const key of Object.keys(batch)) {
          const value = batchTranslations?.[key]
          if (typeof value === 'string') {
            allTranslations[key] = value
            translated.push(key)
          } else {
            failed.push({
              key,
              reason: batchTruncated
                ? 'truncated'
                : batchTranslations === null ? 'provider-error' : 'omitted-by-model',
            })
          }
        }

        await reportProgress(`${target.code}: batch ${batchNum}/${totalBatches}`)
      }

      const placeholderValidation = mergePlaceholderValidation(Object.entries(allTranslations).map(([key, value]) => {
        return validatePlaceholders(key, keysAndValues[key] ?? '', [{ locale: target.code, value }], config.localeFileFormat)
      }))

      if (placeholderValidation && !placeholderValidation.ok) {
        const reasonByKey = new Map<string, TranslateFailReason>()
        for (const error of placeholderValidation.errors) {
          if (!reasonByKey.has(error.key)) {
            reasonByKey.set(error.key, failReasonForIssue(error))
          }
        }
        for (const [key, reason] of reasonByKey) {
          delete allTranslations[key]
          failed.push({ key, reason })
        }
        for (const key of [...translated]) {
          if (reasonByKey.has(key)) translated.splice(translated.indexOf(key), 1)
        }
      }

      if (runState.aborted) {
        // Run is doomed — don't write partial output for an in-flight locale.
        // The returned result is discarded by the rejecting Promise.all.
        return { result: { mode: 'provider', missing, translated: [], failed, skipped: [] } }
      }

      if (Object.keys(allTranslations).length > 0) {
        try {
          await mutateLocaleData(config, layer, target, (data) => {
            for (const [key, value] of Object.entries(allTranslations)) {
              setNestedValue(data, key, value)
            }
          })
        } catch (error) {
          log.warn(`Failed to write translations for ${target.code}: ${toErrorMessage(error)}`)
          // Only the keys that were about to be written failed on write;
          // earlier failures keep their own reasons.
          for (const key of translated) {
            failed.push({ key, reason: 'write-error' })
          }
          return { result: { mode: 'provider', missing, translated: [], failed, skipped: [], batches: totalBatches, model, writeError: toErrorMessage(error) } }
        }
      }

      await reportProgress(`Complete ${target.code}`)
      return { result: { mode: 'provider', missing, translated, failed, skipped: [], batches: totalBatches, model, ...(placeholderValidation ? { placeholderValidation } : {}) } }
    } else {
      // Agent mode: return context for the host agent to translate inline
      const fallbackContext = buildFallbackContext(
        config.projectConfig,
        refLocale!.language || refLocale!.code,
        target.language || target.code,
        keysAndValues,
      )
      await reportProgress(`Complete ${target.code}`)
      return {
        result: {
          mode: 'agent',
          missing,
          translated: [],
          failed: [],
          skipped: Object.keys(keysAndValues).map(key => ({ key, reason: 'no-provider' as const })),
        },
        fallbackContext,
      }
    }
  }

  const localeResults = await Promise.all(targets.map(async (target) => {
    const targetData = targetDataCache.get(target.code) ?? {}
    return translateOneLocale(target, targetData)
  }))

  for (const [i, { result, fallbackContext }] of localeResults.entries()) {
    const target = targets[i]
    if (target === undefined) continue
    const localeCode = target.code
    results[localeCode] = result
    if (fallbackContext) {
      fallbackContexts[localeCode] = fallbackContext
    }
  }

  Object.assign(results, await collectProtectedLocaleResults(config, layer, mode, protectedDefaults, missingKeysIn))

  const totalTranslated = Object.values(results).reduce((sum, r) => sum + r.translated.length, 0)
  const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed.length, 0)
  const totalSkipped = Object.values(results).reduce((sum, r) => sum + r.skipped.length, 0)
  const totalWouldTranslate = Object.values(results).reduce((sum, r) => sum + (r.wouldTranslate?.length ?? 0), 0)

  const summary: Record<string, unknown> = {
    mode,
    totalTranslated,
    totalFailed,
    totalSkipped,
    ...(isDryRun ? { totalWouldTranslate } : {}),
    layer,
    referenceLocale: localeRefInfo(refLocale),
    targetLocales: targets.map(localeRefInfo),
    dryRun: isDryRun,
  }

  const hasFallbackContexts = Object.keys(fallbackContexts).length > 0

  // Compact is a projection of the full result: it may only drop per-key
  // detail, never the fallback contexts, reasons, or locale metadata that
  // change what the caller does next.
  if (opts.compact) {
    const byLocale = Object.entries(results).map(([code, r]) => {
      // Reduce per-key arrays to counts; drop per-key placeholder detail;
      // keep every other per-locale field (mode, missing, batches, model,
      // writeError, …).
      const { translated, failed, skipped, wouldTranslate, placeholderValidation: _placeholderValidation, ...rest } = r
      return {
        locale: code,
        translated: translated.length,
        failed: failed.length,
        skipped: skipped.length,
        ...(wouldTranslate ? { wouldTranslate: wouldTranslate.length } : {}),
        ...rest,
      }
    })
    return {
      summary: { ...summary, byLocale },
      ...(hasFallbackContexts ? { fallbackContexts } : {}),
    }
  }

  const output: Record<string, unknown> = { results, summary }
  if (hasFallbackContexts) {
    output.fallbackContexts = fallbackContexts
  }
  return output
}

/**
 * Translate one key from a source locale into target locales. Unlike
 * translate_missing, this can overwrite stale existing target values.
 */
export async function translateKey(opts: {
  layer: string
  key: string
  sourceLocale: string
  sourceValue?: string
  targetLocales?: string[] | 'all'
  overwrite?: boolean
  dryRun?: boolean
  includePreview?: boolean
  projectDir?: string
  translateFn?: TranslateFn
}): Promise<TranslateKeyResult> {
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false
  const overwrite = opts.overwrite ?? true
  const sourceLocale = findLocaleOrThrow(config, opts.sourceLocale)
  const usesDefaultTargets = opts.targetLocales === undefined || opts.targetLocales === 'all'
  const resolvedTargetLocales = opts.targetLocales === undefined || opts.targetLocales === 'all'
    ? config.locales
    : opts.targetLocales.map(localeRef => findLocaleOrThrow(config, localeRef))
  const { targetLocales, protectedSkipped } = partitionTranslateKeyTargets(
    config, resolvedTargetLocales, sourceLocale.code, usesDefaultTargets,
  )

  const sourceData = await readLocaleData(config, opts.layer, sourceLocale)
  const existingSourceValue = getNestedValue(sourceData, opts.key)
  const sourceValue = opts.sourceValue ?? (typeof existingSourceValue === 'string' ? existingSourceValue : undefined)

  if (sourceValue === undefined) {
    throw new ToolError(`Source value for key "${opts.key}" not found in locale "${opts.sourceLocale}". Provide sourceValue or add the key first.`, 'SOURCE_KEY_NOT_FOUND')
  }

  const preview: Record<string, string> = {}
  let filesWritten = 0
  let updatedSource = false

  if (opts.sourceValue !== undefined && existingSourceValue !== opts.sourceValue) {
    updatedSource = true
    if (opts.includePreview || isDryRun) preview[sourceLocale.code] = opts.sourceValue
    if (!isDryRun) {
      const written = await mutateLocaleData(config, opts.layer, sourceLocale, (data) => {
        setNestedValue(data, opts.key, opts.sourceValue!)
      })
      filesWritten += written.size
    }
  }

  const existingTargets: Array<{ locale: LocaleDefinition, existingValue: unknown }> = []
  const failed: TranslateKeyLocaleIssue[] = []
  for (const locale of targetLocales) {
    try {
      const data = await readLocaleData(config, opts.layer, locale)
      existingTargets.push({ locale, existingValue: getNestedValue(data, opts.key) })
    } catch (error) {
      failed.push({ locale: locale.code, reason: 'read-error', detail: toErrorMessage(error) })
    }
  }

  const targetsToTranslate = existingTargets.filter(({ existingValue }) => {
    return overwrite || existingValue === undefined || existingValue === '' || existingValue === null
  })
  const skipped: Array<{ locale: string, reason: TranslateSkipReason }> = [
    ...protectedSkipped,
    ...existingTargets
      .filter(({ existingValue }) => !overwrite && existingValue !== undefined && existingValue !== '' && existingValue !== null)
      .map(({ locale }) => ({ locale: locale.code, reason: 'already-translated' as const })),
  ]

  const basePlaceholderValidation = validatePlaceholders(opts.key, sourceValue, [{ locale: sourceLocale.code, value: sourceValue }], config.localeFileFormat)

  if (isDryRun) {
    return {
      key: opts.key,
      sourceLocale: localeRefInfo(sourceLocale),
      updatedSource,
      mode: 'dry-run',
      translated: [],
      wouldTranslate: targetsToTranslate.map(({ locale }) => locale.code),
      skipped,
      failed,
      filesWritten: 0,
      dryRun: true,
      placeholderValidation: basePlaceholderValidation,
      ...(opts.includePreview ? { preview } : {}),
    }
  }

  if (targetsToTranslate.length === 0) {
    return {
      key: opts.key,
      sourceLocale: localeRefInfo(sourceLocale),
      updatedSource,
      mode: opts.translateFn ? 'provider' : 'agent',
      translated: [],
      skipped,
      failed,
      filesWritten,
      dryRun: false,
      placeholderValidation: basePlaceholderValidation,
      ...(opts.includePreview ? { preview } : {}),
    }
  }

  if (!opts.translateFn) {
    // Agent mode: nothing was attempted — targets are skipped, not failed.
    return {
      key: opts.key,
      sourceLocale: localeRefInfo(sourceLocale),
      updatedSource,
      mode: 'agent',
      translated: [],
      skipped: [
        ...skipped,
        ...targetsToTranslate.map(({ locale }) => ({ locale: locale.code, reason: 'no-provider' as const })),
      ],
      failed,
      filesWritten,
      dryRun: false,
      placeholderValidation: basePlaceholderValidation,
      fallbackContext: buildFallbackContext(
        config.projectConfig,
        sourceLocale.language || sourceLocale.code,
        targetsToTranslate.map(({ locale }) => locale.language || locale.code).join(', '),
        { [opts.key]: sourceValue },
      ),
      ...(opts.includePreview ? { preview } : {}),
    }
  }

  const translated: string[] = []
  const placeholderValidations: PlaceholderValidationResult[] = [basePlaceholderValidation]
  let model: string | undefined

  for (const { locale } of targetsToTranslate) {
    let targetValue: string | undefined
    let requestFailed = false
    let responseTruncated = false
    const systemPrompt = buildTranslationSystemPrompt(config.projectConfig, locale.language || locale.code, config.localeFileFormat)
    const userMessage = buildTranslationUserMessage(
      sourceLocale.language || sourceLocale.code,
      locale.language || locale.code,
      { [opts.key]: sourceValue },
      config.localeFileFormat,
    )

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        const delayMs = 2000 * 2 ** attempt
        await new Promise(r => setTimeout(r, delayMs))
      }
      try {
        const response = await opts.translateFn({
          systemPrompt,
          userMessage,
          maxTokens: computeMaxTokens(1),
        })
        model = response.model
        if (response.truncated) {
          responseTruncated = true
          log.warn(`Translate response truncated for ${locale.code}: provider hit the token limit.`)
        } else if (response.text.trim() === '') {
          throw new TranslateProviderError('Provider returned an empty response', 'provider')
        } else {
          const parsed = extractJsonFromResponse(response.text)
          const parsedValue = parsed[opts.key]
          if (typeof parsedValue === 'string') {
            targetValue = parsedValue
          }
        }
        requestFailed = false
        break
      } catch (error) {
        if (error instanceof TranslateProviderError && error.kind === 'auth') {
          // Auth failures affect every request — abort the whole run.
          throw new ToolError(
            `Provider authentication failed: ${error.message}. Verify your API key (config apiKey or the provider's environment variable).`,
            'PROVIDER_AUTH_ERROR',
          )
        }
        requestFailed = true
        if (attempt === 0) {
          log.warn(`Translate request failed for ${locale.code}: ${toErrorMessage(error)}. Retrying (attempt 2)`)
        } else {
          log.warn(`Translate retry failed for ${locale.code}: ${toErrorMessage(error)}`)
        }
      }
    }

    if (!targetValue) {
      failed.push({
        locale: locale.code,
        reason: responseTruncated ? 'truncated' : requestFailed ? 'provider-error' : 'omitted-by-model',
      })
      continue
    }

    const validation = validatePlaceholders(opts.key, sourceValue, [{ locale: locale.code, value: targetValue }], config.localeFileFormat)
    placeholderValidations.push(validation)
    const firstIssue = validation.errors[0]
    if (firstIssue !== undefined) {
      failed.push({ locale: locale.code, reason: failReasonForIssue(firstIssue) })
      continue
    }

    if (opts.includePreview) preview[locale.code] = targetValue
    try {
      const written = await mutateLocaleData(config, opts.layer, locale, (data) => {
        setNestedValue(data, opts.key, targetValue)
      })
      filesWritten += written.size
      translated.push(locale.code)
    } catch (error) {
      failed.push({ locale: locale.code, reason: 'write-error', detail: toErrorMessage(error) })
    }
  }

  return {
    key: opts.key,
    sourceLocale: localeRefInfo(sourceLocale),
    updatedSource,
    mode: 'provider',
    translated,
    skipped,
    failed,
    filesWritten,
    dryRun: false,
    model,
    placeholderValidation: mergePlaceholderValidation(placeholderValidations) ?? basePlaceholderValidation,
    ...(opts.includePreview ? { preview } : {}),
  }
}
