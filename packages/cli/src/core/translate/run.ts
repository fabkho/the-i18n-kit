/**
 * The translate operations themselves: translate_missing (single layer and
 * all layers) and translate_key. Target resolution, prompts, response parsing
 * and the request loop live in the sibling modules.
 */

import { detectI18nConfig } from '../../config/detector.js'
import { buildLayerGraph } from '../../config/layer-graph.js'
import type { I18nConfig, LocaleDefinition } from '../../config/types.js'
import { readLocaleData, mutateLocaleData } from '../../io/locale-data.js'
import {
  getNestedValue,
  setNestedValue,
  getLeafKeys,
} from '../../io/key-operations.js'
import { log } from '../../utils/logger.js'
import { ToolError, toErrorMessage } from '../../utils/errors.js'

import type {
  TranslateFn,
  ProgressFn,
  TranslateLayerTotals,
  TranslateMode,
  TranslateFailReason,
  TranslateSkipReason,
  TranslateKeyLocaleIssue,
  TranslateMissingLocaleResult,
  PlaceholderValidationResult,
  TranslateKeyResult,
  TranslateMissingResult,
  TranslateMissingOutcome,
  TranslateAllLayersResult,
  TranslateAllLayersSummary,
} from '../types.js'
import { findWritableLayerOrThrow, findReferenceLocaleOrThrow, findLocaleOrThrow, localeRefInfo } from '../shared.js'
import { resolveTranslateTargets, collectProtectedLocaleResults, partitionTranslateKeyTargets } from './targets.js'
import { validatePlaceholders, mergePlaceholderValidation, failReasonForIssue } from './placeholders.js'
import { buildTranslationSystemPrompt, buildTranslationUserMessage, buildFallbackContext } from './prompts.js'
import { extractJsonFromResponse } from './json-salvage.js'
import { requestWithRetry } from './retry.js'
import type { TranslateRunState } from './retry.js'

/**
 * Fixed maxTokens budget for a translate request. Deliberately independent
 * of batch size — models simply stop when the JSON object is closed.
 */
const TRANSLATE_MAX_TOKENS = 16384

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
 * Find keys missing in target locales and translate them.
 *
 * When translateFn is provided, uses it to translate via LLM.
 * When translateFn is absent, returns fallback contexts for the agent.
 *
 * When `layer` is omitted, every canonical locale-backed layer is translated
 * in one run and the results are aggregated (see translateMissingAllLayers).
 */
export async function translateMissing(opts: {
  layer?: string
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
}): Promise<TranslateMissingOutcome> {
  if (opts.layer === undefined) return translateMissingAllLayers(opts)
  const layer = opts.layer
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? false
  const maxBatch = opts.batchSize ?? 50
  if (!Number.isFinite(maxBatch) || maxBatch <= 0 || !Number.isInteger(maxBatch)) {
    throw new ToolError(`Invalid batchSize: ${opts.batchSize}. Must be a positive integer.`, 'INVALID_BATCH_SIZE')
  }

  findWritableLayerOrThrow(config, layer)

  const refCode = opts.referenceLocale ?? config.defaultLocale
  const refLocale = findReferenceLocaleOrThrow(config, opts.referenceLocale)

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
  const runState: TranslateRunState = { aborted: false }

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

        const systemPrompt = buildTranslationSystemPrompt(config.projectConfig, target.language || target.code, config.localeFileFormat)
        const userMessage = buildTranslationUserMessage(
          refLocale!.language || refLocale!.code,
          target.language || target.code,
          batch,
          config.localeFileFormat,
        )

        const outcome = await requestWithRetry(
          opts.translateFn,
          { systemPrompt, userMessage, maxTokens: TRANSLATE_MAX_TOKENS },
          {
            label: `batch ${batchNum} in ${target.code}`,
            truncationHint: 'Reduce batchSize.',
            logModel: true,
            runState,
            parse: (text) => {
              // Keys the model invented are dropped here; keys it omitted are
              // accounted for below.
              const parsed = extractJsonFromResponse(text)
              const batchKeys = new Set(Object.keys(batch))
              const batchTranslations: Record<string, string> = {}
              for (const [key, value] of Object.entries(parsed)) {
                if (batchKeys.has(key) && typeof value === 'string') {
                  batchTranslations[key] = value
                }
              }
              return batchTranslations
            },
          },
        )
        model = outcome.model ?? model
        const batchTranslations = outcome.status === 'ok' ? outcome.value : null
        const batchTruncated = outcome.status === 'truncated'

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

  const summary: TranslateMissingResult['summary'] = {
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

  const output: TranslateMissingResult = { results, summary }
  if (hasFallbackContexts) {
    output.fallbackContexts = fallbackContexts
  }
  return output
}

/**
 * All-layers mode: run the single-layer translate pipeline once per canonical
 * locale-backed layer and aggregate into one result. The existing summary
 * fields (`totalTranslated`, `totalFailed`, `totalSkipped`,
 * `totalWouldTranslate`) become cross-layer totals — jq consumers of the
 * single-layer summary keep working unchanged. `summary.byLayer` and the
 * per-layer `layers` sections (each in the single-layer result shape) are
 * additive.
 */
async function translateMissingAllLayers(
  opts: Omit<Parameters<typeof translateMissing>[0], 'layer'>,
): Promise<TranslateAllLayersResult> {
  const config = await detectI18nConfig(opts.projectDir ?? process.cwd())
  const layerNames = collectTranslatableLayers(config)
  if (layerNames.length === 0) {
    throw new ToolError('No locale-backed layers detected. Use list_locale_dirs to inspect the configuration.', 'LAYER_NOT_FOUND')
  }
  const { layers, byLayer } = await runLayerTranslations(layerNames, opts)
  return { layers, summary: buildAllLayersSummary(layers, byLayer, opts) }
}

/**
 * Layers eligible for an all-layers run: each physical locale dir exactly
 * once. Aliases are excluded via canonicalLayers, and same-path canonical
 * entries (possible in hand-written generic configs) collapse to the first —
 * an aliased app layer must never cause a second translate/write of its
 * owner's files.
 */
function collectTranslatableLayers(config: I18nConfig): string[] {
  const seenPaths = new Set<string>()
  const layerNames: string[] = []
  for (const localeDir of buildLayerGraph(config).canonicalLayers) {
    if (seenPaths.has(localeDir.path)) continue
    seenPaths.add(localeDir.path)
    layerNames.push(localeDir.layer)
  }
  return layerNames
}

async function runLayerTranslations(
  layerNames: string[],
  opts: Omit<Parameters<typeof translateMissing>[0], 'layer'>,
): Promise<{ layers: Record<string, TranslateMissingResult>, byLayer: TranslateLayerTotals[] }> {
  const layers: Record<string, TranslateMissingResult> = {}
  const byLayer: TranslateLayerTotals[] = []
  for (const layerName of layerNames) {
    let layerResult: TranslateMissingResult
    try {
      // A named layer always takes the single-layer branch.
      layerResult = await translateMissing({ ...opts, layer: layerName }) as TranslateMissingResult
    } catch (error) {
      // A layer without reference-locale data has nothing to drive
      // translation — skip it so one sparse layer cannot fail the run for
      // its siblings. Explicit single-layer calls still throw.
      if (error instanceof ToolError && error.code === 'NO_LOCALE_FILE') {
        log.warn(`Skipping layer "${layerName}": ${error.message}`)
        continue
      }
      throw error
    }
    layers[layerName] = layerResult
    byLayer.push(layerTotals(layerName, layerResult))
  }
  return { layers, byLayer }
}

function layerTotals(layerName: string, layerResult: TranslateMissingResult): TranslateLayerTotals {
  const layerSummary = layerResult.summary as {
    totalTranslated: number
    totalFailed: number
    totalSkipped: number
    totalWouldTranslate?: number
  }
  return {
    layer: layerName,
    totalTranslated: layerSummary.totalTranslated,
    totalFailed: layerSummary.totalFailed,
    totalSkipped: layerSummary.totalSkipped,
    totalWouldTranslate: layerSummary.totalWouldTranslate ?? 0,
  }
}

function buildAllLayersSummary(
  layers: Record<string, TranslateMissingResult>,
  byLayer: TranslateLayerTotals[],
  opts: Omit<Parameters<typeof translateMissing>[0], 'layer'>,
): TranslateAllLayersSummary {
  const isDryRun = opts.dryRun ?? false
  const total = (pick: (l: TranslateLayerTotals) => number): number =>
    byLayer.reduce((sum, l) => sum + pick(l), 0)
  // Locales are project-global, so mode, reference locale, and target set are
  // identical across layers — hoist them from the first translated layer.
  const first = Object.values(layers)[0]?.summary
  const summary: TranslateAllLayersSummary = {
    mode: isDryRun ? 'dry-run' : opts.translateFn ? 'provider' : 'agent',
    totalTranslated: total(l => l.totalTranslated),
    totalFailed: total(l => l.totalFailed),
    totalSkipped: total(l => l.totalSkipped),
    ...(isDryRun ? { totalWouldTranslate: total(l => l.totalWouldTranslate) } : {}),
    layers: byLayer.map(l => l.layer),
    byLayer,
    dryRun: isDryRun,
  }
  if (first?.referenceLocale !== undefined) summary.referenceLocale = first.referenceLocale
  if (first?.targetLocales !== undefined) summary.targetLocales = first.targetLocales
  return summary
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
    const systemPrompt = buildTranslationSystemPrompt(config.projectConfig, locale.language || locale.code, config.localeFileFormat)
    const userMessage = buildTranslationUserMessage(
      sourceLocale.language || sourceLocale.code,
      locale.language || locale.code,
      { [opts.key]: sourceValue },
      config.localeFileFormat,
    )

    const outcome = await requestWithRetry(
      opts.translateFn,
      { systemPrompt, userMessage, maxTokens: TRANSLATE_MAX_TOKENS },
      {
        label: locale.code,
        parse: (text) => {
          const parsedValue = extractJsonFromResponse(text)[opts.key]
          return typeof parsedValue === 'string' ? parsedValue : undefined
        },
      },
    )
    model = outcome.model ?? model
    const targetValue = outcome.status === 'ok' ? outcome.value : undefined

    if (!targetValue) {
      failed.push({
        locale: locale.code,
        reason: outcome.status === 'truncated'
          ? 'truncated'
          : outcome.status === 'failed' ? 'provider-error' : 'omitted-by-model',
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
