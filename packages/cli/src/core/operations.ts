/**
 * Core i18n operations — pure async functions with no MCP dependency.
 *
 * Each function accepts plain parameters and returns plain objects.
 * Errors are thrown (ToolError etc.) rather than returned as isError responses.
 */

import { resolve, relative } from 'node:path'
import { readdir } from 'node:fs/promises'

import { detectI18nConfig, clearConfigCache } from '../config/detector.js'
import type { I18nConfig, LocaleDefinition, LocaleDir, ProjectConfig } from '../config/types.js'
import type { LocaleFileFormat } from '../adapters/types.js'
import { writeReportFile } from '../io/json-writer.js'
import { readLocaleData, mutateLocaleData, resolveLocaleEntries } from '../io/locale-data.js'
import {
  getNestedValue,
  setNestedValue,
  hasNestedKey,
  getLeafKeys,
  removeNestedValue,
  renameNestedKey,
  validateTranslationValue,
} from '../io/key-operations.js'
import { scanSourceFiles, toRelativePath, findOrphanKeysForConfig } from '../scanner/code-scanner.js'
import { getPatternSet } from '../scanner/patterns.js'
import { log } from '../utils/logger.js'
import { ToolError, toErrorMessage } from '../utils/errors.js'
import { TranslateProviderError } from '../llm/providers.js'
import { scaffoldLocale } from '../tools/scaffold-locale.js'

import type {
  LocaleDirInfo,
  MutationResult,
  SearchMatch,
  TranslateFn,
  ProgressFn,
  TranslateMode,
  TranslateFailReason,
  TranslateSkipReason,
  TranslateKeyLocaleIssue,
  TranslateMissingLocaleResult,
  AddTranslationsResult,
  WriteTranslationsResult,
  UpdateTranslationsResult,
  ScaffoldLocaleResult,
  PlaceholderValidationResult,
  LocaleRefInfo,
  TranslateKeyResult,
} from './types.js'

// ─── Constants ──────────────────────────────────────────────────

const DEFAULT_REPORT_DIR = '.i18n-reports'

// ─── Shared helpers (exported for reuse) ────────────────────────

/**
 * Fixed maxTokens budget for a translate request. Batch size no longer
 * scales the budget — models simply stop when the JSON object is closed.
 */
export function computeMaxTokens(_batchKeyCount: number): number {
  return 16384
}

/**
 * Compute the total number of progress steps for translate_missing.
 */
export function computeProgressTotal(missingKeyCounts: number[], maxBatch: number): number {
  return missingKeyCounts.reduce((sum, count) => {
    if (count <= 0) return sum
    return sum + Math.ceil(count / maxBatch) + 2
  }, 0)
}

export function validateReportPath(baseDir: string, absPath: string): void {
  const normalizedBase = resolve(baseDir)
  const normalizedPath = resolve(absPath)
  const rel = relative(normalizedBase, normalizedPath)
  if (rel.startsWith('..') || rel === '') {
    throw new ToolError(
      `Report path "${absPath}" resolves outside the project directory. Path must stay within "${normalizedBase}".`,
      'INVALID_REPORT_PATH',
    )
  }
}

export function resolveReportFilePath(
  config: I18nConfig,
  dir: string,
  toolName: string,
): string | undefined {
  const reportOutput = config.projectConfig?.reportOutput
  if (!reportOutput) return undefined
  const relDir = reportOutput === true ? DEFAULT_REPORT_DIR : reportOutput
  const absPath = resolve(dir, relDir, `${toolName}.json`)
  validateReportPath(dir, absPath)
  return absPath
}

export function resolveOrphanIgnorePatterns(
  config: I18nConfig,
  layer: string | undefined,
): string[] | undefined {
  if (!layer || !config.projectConfig?.orphanScan) return undefined
  const layerConfig = config.projectConfig.orphanScan[layer]
  if (!layerConfig?.ignorePatterns?.length) return undefined
  return layerConfig.ignorePatterns
}

/**
 * Look up a locale directory by layer name and throw LAYER_NOT_FOUND with fuzzy
 * matching hints if the name is not found.
 */
export function findLayerOrThrow(config: I18nConfig, layer: string): LocaleDir {
  const localeDir = config.localeDirs.find(d => d.layer === layer)
  if (!localeDir) {
    const available = config.localeDirs.map(d => d.layer).join(', ')
    const layerRule = config.projectConfig?.layerRules?.find(r => r.layer === layer)
    const fuzzyHint = layerRule
      ? ` Note: "${layer}" matches a layerRules entry in .i18n-mcp.json but is not an internal layer name.`
      : ''
    throw new ToolError(
      `Layer not found: "${layer}". Available: ${available}.${fuzzyHint} Use list_locale_dirs to see all layers.`,
      'LAYER_NOT_FOUND',
    )
  }
  return localeDir
}

export function localeRefInfo(locale: LocaleDefinition): LocaleRefInfo {
  return {
    code: locale.code,
    ...(locale.language ? { language: locale.language } : {}),
    ...(locale.file ? { file: locale.file } : {}),
    ...(locale.name ? { name: locale.name } : {}),
  }
}

function localeAcceptedRefs(locale: LocaleDefinition): string[] {
  return [locale.code, locale.language, locale.file].filter(Boolean) as string[]
}

function formatLocaleChoices(locales: LocaleDefinition[]): string {
  return locales
    .map(locale => `- code: ${locale.code}${locale.language ? `, language: ${locale.language}` : ''}${locale.file ? `, file: ${locale.file}` : ''}${locale.name ? `, name: ${locale.name}` : ''}`)
    .join('\n')
}

function findLocaleSuggestion(config: I18nConfig, localeRef: string): string {
  const normalized = localeRef.endsWith('.json') ? localeRef.slice(0, -5) : localeRef
  const suggestion = config.locales.find((locale) => {
    return localeAcceptedRefs(locale).some((ref) => {
      const normalizedRef = ref.endsWith('.json') ? ref.slice(0, -5) : ref
      return normalizedRef === normalized
        || normalizedRef.toLowerCase() === normalized.toLowerCase()
        || normalizedRef.includes(normalized)
        || normalized.includes(normalizedRef)
    })
  })
  if (!suggestion) return ''

  const refs = localeAcceptedRefs(suggestion).map(ref => `"${ref}"`).join(' or ')
  return ` Did you mean ${refs}?`
}

export function findLocaleImpl(config: I18nConfig, localeRef: string) {
  return config.locales.find(
    l => l.code === localeRef || l.file === localeRef || l.language === localeRef,
  )
}

export function findLocaleOrThrow(config: I18nConfig, localeRef: string): LocaleDefinition {
  const locale = findLocaleImpl(config, localeRef)
  if (!locale) {
    throw new ToolError(
      `Locale not found: "${localeRef}".${findLocaleSuggestion(config, localeRef)}\nAvailable locales:\n${formatLocaleChoices(config.locales)}`,
      'LOCALE_NOT_FOUND',
    )
  }
  return locale
}

/**
 * Shared logic for write_translations (supports add, update, and upsert modes).
 */
export async function applyTranslations(
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
      const locale = findLocale(config, localeRef)
      if (!locale) {
        log.warn(`Locale not found: ${localeRef}, skipping.${findLocaleSuggestion(config, localeRef)}`)
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

  const result: MutationResult = {
    applied: [...new Set(applied)],
    skipped: [...new Set(skipped)],
    warnings,
    filesWritten: filesWritten.size,
  }

  if (placeholderValidation) {
    result.placeholderValidation = placeholderValidation
  }

  if (dryRun) {
    result.preview = preview
  }

  return result
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
        const variantPlaceholders = extractPlaceholders(sourceVariant, format)
        const diff = diffPlaceholders(variantPlaceholders, targetVariants[index], format)
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

function mergePlaceholderValidation(
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
 * Detect the i18n configuration from the project.
 */
export async function detectConfig(projectDir?: string): Promise<I18nConfig> {
  const dir = projectDir ?? process.cwd()
  clearConfigCache()
  return detectI18nConfig(dir)
}

/**
 * List all i18n locale directories in the project, grouped by layer.
 */
export async function listLocaleDirs(projectDir?: string): Promise<LocaleDirInfo[]> {
  const dir = projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const results: LocaleDirInfo[] = []

  for (const localeDir of config.localeDirs) {
    if (localeDir.aliasOf) {
      results.push({
        layer: localeDir.layer,
        path: localeDir.path,
        aliasOf: localeDir.aliasOf,
        fileCount: 0,
        topLevelKeys: [],
      })
      continue
    }

    if (config.localeFileFormat === 'php-array') {
      let subDirs: string[] = []
      try { subDirs = await readdir(localeDir.path) } catch {}

      const sampleLocale = config.locales[0]
      let namespaces: string[] = []
      if (sampleLocale) {
        try {
          const entries = await resolveLocaleEntries(config, localeDir.layer, sampleLocale)
          namespaces = entries.map(e => e.namespace).filter((n): n is string => n !== null)
        } catch {}
      }

      results.push({
        layer: localeDir.layer,
        path: localeDir.path,
        fileCount: subDirs.length,
        namespaces,
      })
    } else {
      const files = await readdir(localeDir.path)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      let topLevelKeys: string[] = []
      if (config.locales.length > 0 && jsonFiles.length > 0) {
        try {
          const sampleLocale = config.locales[0]
          const data = await readLocaleData(config, localeDir.layer, sampleLocale)
          topLevelKeys = Object.keys(data)
        } catch {}
      }

      results.push({
        layer: localeDir.layer,
        path: localeDir.path,
        fileCount: jsonFiles.length,
        topLevelKeys,
      })
    }
  }

  return results
}

/**
 * Get translation values for given key paths from a specific locale and layer.
 */
export async function getTranslations(opts: {
  layer: string
  locale: string
  keys: string[]
  compact?: boolean
  projectDir?: string
}): Promise<Record<string, Record<string, unknown>>> {
  const { layer, locale, keys } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  // Validate layer exists
  findLayerOrThrow(config, layer)

  const localesToRead = locale === '*'
    ? config.locales
    : (() => {
        const found = findLocaleImpl(config, locale)
        if (!found) {
          throw new ToolError(`Locale not found: "${locale}". Available: ${config.locales.map(l => l.code).join(', ')}. Use one of the available locale codes or file names.`, 'LOCALE_NOT_FOUND')
        }
        return [found]
      })()

  const results: Record<string, Record<string, unknown>> = {}

  for (const loc of localesToRead) {
    const data = await readLocaleData(config, layer, loc)
    results[loc.code] = Object.fromEntries(
      keys.map(k => [k, getNestedValue(data, k) ?? null]),
    )
  }

  // Compact mode: summarize by key across all locales
  if (opts.compact && locale === '*' && localesToRead.length > 1) {
    const byKey: Record<string, { status: string; totalPresent: number; empty?: string[]; missing?: string[] }> = {}
    for (const key of keys) {
      let present = 0
      const empty: string[] = []
      const missing: string[] = []
      for (const loc of localesToRead) {
        const val = results[loc.code]?.[key]
        if (val === undefined || val === null) {
          missing.push(loc.code)
        } else if (val === '') {
          empty.push(loc.code)
        } else {
          present++
        }
      }
      byKey[key] = {
        status: present === localesToRead.length ? 'ok' : present > 0 ? 'partial' : 'missing',
        totalPresent: present,
        ...(empty.length > 0 && { empty }),
        ...(missing.length > 0 && { missing }),
      }
    }
    return { byKey } as unknown as Record<string, Record<string, unknown>>
  }

  return results
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

  const { applied, skipped, warnings, filesWritten, preview, placeholderValidation } = await applyTranslations(
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
    return result
  }

  const result: WriteTranslationsResult = {
    written: applied,
    skipped,
    filesWritten,
  }
  if (warnings.length > 0) { result.warnings = warnings }
  if (placeholderValidation) { result.placeholderValidation = placeholderValidation }
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

  const { applied, skipped, warnings, filesWritten, preview, placeholderValidation } = await applyTranslations(
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

  const { applied, skipped, filesWritten, preview, placeholderValidation } = await applyTranslations(
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
 * Find translation keys that exist in the reference locale but are missing in other locales.
 */
export async function getMissingTranslations(opts: {
  layer?: string
  referenceLocale?: string
  targetLocales?: string[]
  locales?: string[]
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  // Determine reference locale
  const refCode = opts.referenceLocale ?? config.defaultLocale
  const refLocale = findLocaleImpl(config, refCode)
  if (!refLocale) {
    throw new ToolError(`Reference locale not found: "${refCode}". Available: ${config.locales.map(l => l.code).join(', ')}. Pass a valid locale code as referenceLocale, or omit it to use the project default.`, 'REFERENCE_LOCALE_NOT_FOUND')
  }

  // Determine target locales
  const resolvedTargets = opts.targetLocales ?? opts.locales
  const targets = resolvedTargets
    ? resolvedTargets.map((code) => {
        const loc = findLocaleImpl(config, code)
        if (!loc) {
          throw new ToolError(`Target locale not found: "${code}". Available: ${config.locales.map(l => l.code).join(', ')}. Pass valid locale codes in targetLocales.`, 'LOCALE_NOT_FOUND')
        }
        return loc
      })
    : config.locales.filter(l => l.code !== refLocale.code)

  // Determine layers to scan
  const layersToScan = layer
    ? config.localeDirs.filter(d => d.layer === layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToScan.length === 0) {
    if (layer) {
      findLayerOrThrow(config, layer)
    }
    throw new ToolError('No locale directories found. Run detect_i18n_config to verify the project setup.', 'LAYER_NOT_FOUND')
  }

  const result: Record<string, Record<string, string[]>> = {}
  let totalMissing = 0

  for (const localeDir of layersToScan) {
    let refData: Record<string, unknown>
    try {
      refData = await readLocaleData(config, localeDir.layer, refLocale)
    } catch {
      continue
    }
    if (Object.keys(refData).length === 0) continue

    const refKeys = getLeafKeys(refData).filter(k => {
      const v = getNestedValue(refData, k)
      return typeof v === 'string' ? v.length > 0 : v !== null && v !== undefined
    })
    if (refKeys.length === 0) continue

    for (const target of targets) {
      let targetData: Record<string, unknown> = {}

      try {
        targetData = await readLocaleData(config, localeDir.layer, target)
      } catch {}

      const missing = refKeys.filter(k => {
        const v = getNestedValue(targetData, k)
        return v === undefined || v === '' || v === null
      })

      if (missing.length > 0) {
        if (!result[target.code]) {
          result[target.code] = {}
        }
        result[target.code][localeDir.layer] = missing
        totalMissing += missing.length
      }
    }
  }

  const output = {
    missing: result,
    summary: {
      referenceLocale: localeRefInfo(refLocale),
      targetLocales: targets.map(localeRefInfo),
      layersScanned: layersToScan.map(d => d.layer),
      totalMissingKeys: totalMissing,
    },
  }

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'get_missing_translations')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'get_missing_translations',
      args: { layer, referenceLocale: opts.referenceLocale, targetLocales: opts.targetLocales },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Find translation keys that have empty string values in locale files.
 */
export async function findEmptyTranslations(opts: {
  layer?: string
  locale?: string
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  // Determine locales to check
  const localesToCheck = locale
    ? (() => {
        const loc = findLocaleImpl(config, locale)
        if (!loc) {
          throw new ToolError(
            `Locale not found: "${locale}". Available: ${config.locales.map(l => l.code).join(', ')}`,
            'LOCALE_NOT_FOUND',
          )
        }
        return [loc]
      })()
    : config.locales

  // Determine layers to scan
  const layersToScan = layer
    ? config.localeDirs.filter(d => d.layer === layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToScan.length === 0) {
    if (layer) {
      findLayerOrThrow(config, layer)
    }
    throw new ToolError('No locale directories found.', 'LAYER_NOT_FOUND')
  }

  const emptyKeys: Record<string, Record<string, string[]>> = {}
  let totalEmpty = 0

  for (const localeDir of layersToScan) {
    for (const loc of localesToCheck) {
      let data: Record<string, unknown>
      try {
        data = await readLocaleData(config, localeDir.layer, loc)
      } catch {
        continue
      }
      if (Object.keys(data).length === 0) continue

      const leafKeys = getLeafKeys(data)
      const empty = leafKeys.filter(k => getNestedValue(data, k) === '')

      if (empty.length > 0) {
        if (!emptyKeys[loc.code]) emptyKeys[loc.code] = {}
        emptyKeys[loc.code][localeDir.layer] = empty
        totalEmpty += empty.length
      }
    }
  }

  const output = {
    emptyKeys,
    summary: {
      totalEmpty,
      localesChecked: localesToCheck.map(l => l.code),
      layersChecked: layersToScan.map(d => d.layer),
    },
  }

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_empty_translations')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'find_empty_translations',
      args: { layer, locale },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Search translation files by key pattern or value substring.
 */
export async function searchTranslations(opts: {
  query: string
  searchIn?: 'keys' | 'values' | 'both'
  layer?: string
  locale?: string
  projectDir?: string
  outputFile?: string
}): Promise<{ matches: SearchMatch[]; totalMatches: number } | { reportFile: string; summary: { totalMatches: number } }> {
  const { query, layer, locale, outputFile } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const mode = opts.searchIn ?? 'both'
  const queryLower = query.toLowerCase()

  // Determine layers to search
  const layersToSearch = (layer && layer !== '*')
    ? config.localeDirs.filter(d => d.layer === layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToSearch.length === 0) {
    if (layer && layer !== '*') {
      findLayerOrThrow(config, layer)
    }
    throw new ToolError('No locale directories found. Run detect_i18n_config to verify the project setup.', 'LAYER_NOT_FOUND')
  }

  // Determine locales to search
  const localesToSearch = locale
    ? (() => {
        const found = findLocaleImpl(config, locale)
        if (!found) {
          throw new ToolError(`Locale not found: "${locale}". Available: ${config.locales.map(l => l.code).join(', ')}. Use one of the available locale codes or file names.`, 'LOCALE_NOT_FOUND')
        }
        return [found]
      })()
    : config.locales

  const matches: SearchMatch[] = []

  for (const localeDir of layersToSearch) {
    for (const loc of localesToSearch) {
      let data: Record<string, unknown>
      try {
        data = await readLocaleData(config, localeDir.layer, loc)
      } catch {
        continue
      }
      if (Object.keys(data).length === 0) continue

      const leafKeys = getLeafKeys(data)

      for (const key of leafKeys) {
        const value = getNestedValue(data, key)
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value)

        const keyMatch = mode === 'keys' || mode === 'both'
          ? key.toLowerCase().includes(queryLower)
          : false
        const valueMatch = mode === 'values' || mode === 'both'
          ? valueStr.toLowerCase().includes(queryLower)
          : false

        if (keyMatch || valueMatch) {
          matches.push({
            layer: localeDir.layer,
            locale: loc.code,
            key,
            value,
          })
        }
      }
    }
  }

  const output = { matches, totalMatches: matches.length }

  const reportPath = outputFile ?? resolveReportFilePath(config, dir, 'search_translations')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'search_translations',
      args: { query, searchIn: opts.searchIn, layer, locale },
    })
    return { reportFile: reportPath, summary: { totalMatches: matches.length } }
  }

  return output
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

  const localeDir = findLayerOrThrow(config, layer)
  if (localeDir.aliasOf) {
    throw new ToolError(`Layer "${layer}" is an alias of "${localeDir.aliasOf}". Modify the source layer "${localeDir.aliasOf}" instead.`, 'LAYER_IS_ALIAS')
  }

  const preview: Array<{ locale: string; key: string; oldValue: unknown }> = []
  const removed: string[] = []
  const notFound: string[] = []
  const filesWritten = new Set<string>()

  for (const locale of config.locales) {
    let data: Record<string, unknown>
    try {
      data = await readLocaleData(config, layer, locale)
    } catch {
      continue
    }
    if (Object.keys(data).length === 0) continue

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

  const localeDir = findLayerOrThrow(config, layer)
  if (localeDir.aliasOf) {
    throw new ToolError(`Layer "${layer}" is an alias of "${localeDir.aliasOf}". Modify the source layer "${localeDir.aliasOf}" instead.`, 'LAYER_IS_ALIAS')
  }

  const preview: Array<{ locale: string; oldKey: string; newKey: string; value: unknown }> = []
  const renamed: string[] = []
  const notFoundArr: string[] = []
  const conflicts: string[] = []
  const filesWritten = new Set<string>()

  for (const locale of config.locales) {
    let data: Record<string, unknown>
    try {
      data = await readLocaleData(config, layer, locale)
    } catch {
      continue
    }
    if (Object.keys(data).length === 0) continue

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

  // Validate layer
  const localeDir = findLayerOrThrow(config, layer)
  if (localeDir.aliasOf) {
    throw new ToolError(`Layer "${layer}" is an alias of "${localeDir.aliasOf}". Modify the source layer "${localeDir.aliasOf}" instead.`, 'LAYER_IS_ALIAS')
  }

  // Determine reference locale
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
  const targets = resolvedTargetLocales
    ? resolvedTargetLocales.map((code) => {
        const loc = findLocaleImpl(config, code)
        if (!loc) {
          throw new ToolError(`Target locale not found: "${code}". Available: ${config.locales.map(l => l.code).join(', ')}. Pass valid locale codes in targetLocales.`, 'LOCALE_NOT_FOUND')
        }
        return loc
      })
    : config.locales.filter(l => l.code !== refLocale.code)

  const mode: TranslateMode = isDryRun ? 'dry-run' : opts.translateFn ? 'provider' : 'agent'
  const reportProgress = opts.progressFn ?? (async () => {})

  /** Check whether a key is missing in a given locale data object */
  function isKeyMissingIn(data: Record<string, unknown>, k: string): boolean {
    const v = getNestedValue(data, k)
    return v === undefined || v === '' || v === null
  }

  /** Count missing keys for a target locale's data */
  function countMissingKeys(data: Record<string, unknown>): number {
    const isMissing = (k: string) => isKeyMissingIn(data, k)
    return opts.keys
      ? opts.keys.filter(k => isMissing(k) && allRefKeys.includes(k)).length
      : allRefKeys.filter(k => isMissing(k)).length
  }

  // Pre-scan: count missing keys per target to compute progressTotal
  if (opts.onProgressTotal) {
    const preScanCounts: number[] = []
    for (const target of targets) {
      let scanData: Record<string, unknown> = {}
      try {
        scanData = await readLocaleData(config, layer, target)
      } catch {}
      preScanCounts.push(countMissingKeys(scanData))
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
    let missingKeys: string[]
    if (opts.keys) {
      missingKeys = opts.keys.filter(k => isKeyMissingIn(targetData, k) && allRefKeys.includes(k))
    } else {
      missingKeys = allRefKeys.filter(k => isKeyMissingIn(targetData, k))
    }

    if (missingKeys.length === 0) {
      return { result: { mode, missing: 0, translated: [], failed: [], skipped: [] } }
    }

    await reportProgress(`Starting ${target.code}: ${missingKeys.length} missing keys`)

    // Build key-value pairs from reference
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
    const localeCode = targets[i].code
    results[localeCode] = result
    if (fallbackContext) {
      fallbackContexts[localeCode] = fallbackContext
    }
  }

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
  const targetLocalesByCode = new Map<string, LocaleDefinition>()
  const resolvedTargetLocales = opts.targetLocales === undefined || opts.targetLocales === 'all'
    ? config.locales
    : opts.targetLocales.map(localeRef => findLocaleOrThrow(config, localeRef))
  for (const locale of resolvedTargetLocales) {
    if (locale.code !== sourceLocale.code && !targetLocalesByCode.has(locale.code)) {
      targetLocalesByCode.set(locale.code, locale)
    }
  }
  const targetLocales = [...targetLocalesByCode.values()]

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
  const skipped: Array<{ locale: string, reason: TranslateSkipReason }> = existingTargets
    .filter(({ existingValue }) => !overwrite && existingValue !== undefined && existingValue !== '' && existingValue !== null)
    .map(({ locale }) => ({ locale: locale.code, reason: 'already-translated' as const }))

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
    if (!validation.ok) {
      failed.push({ locale: locale.code, reason: failReasonForIssue(validation.errors[0]) })
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

/**
 * Shared helper for findOrphanKeys and removeOrphanKeys.
 * Resolves the locale, filters layers, validates aliases, and builds the
 * keysByLayer Map. Returns the resolved context — or throws on invalid input.
 * The caller handles the empty-report case (totalKeys === 0).
 */
async function resolveOrphanScanContext(
  config: I18nConfig,
  opts: { layer?: string; locale?: string; dir: string; toolName: string },
): Promise<{
  layersToCheck: LocaleDir[]
  keysByLayer: Map<string, { keys: string[]; localeDir: LocaleDir }>
  totalKeys: number
  localeCode: string
}> {
  const localeCode = opts.locale ?? config.defaultLocale
  const localeDef = findLocaleImpl(config, localeCode)
  if (!localeDef) {
    throw new ToolError(
      `Locale not found: "${localeCode}". Available: ${config.locales.map(l => l.code).join(', ')}`,
      'LOCALE_NOT_FOUND',
    )
  }

  const layersToCheck = opts.layer
    ? config.localeDirs.filter(d => d.layer === opts.layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToCheck.length === 0) {
    if (opts.layer) {
      findLayerOrThrow(config, opts.layer)
    }
    throw new ToolError('No locale directories found.', 'LAYER_NOT_FOUND')
  }

  if (opts.layer && layersToCheck[0]?.aliasOf) {
    throw new ToolError(
      `Layer "${opts.layer}" is an alias of "${layersToCheck[0].aliasOf}". Use the target layer instead.`,
      'LAYER_IS_ALIAS',
    )
  }

  const keysByLayer = new Map<string, { keys: string[]; localeDir: LocaleDir }>()
  for (const ld of layersToCheck) {
    let data: Record<string, unknown>
    try {
      data = await readLocaleData(config, ld.layer, localeDef)
    } catch {
      continue
    }
    if (Object.keys(data).length === 0) continue
    keysByLayer.set(ld.layer, { keys: getLeafKeys(data), localeDir: ld })
  }

  const totalKeys = [...keysByLayer.values()].reduce((sum, v) => sum + v.keys.length, 0)

  return { layersToCheck, keysByLayer, totalKeys, localeCode }
}

/**
 * Find translation keys that exist in locale files but are not referenced in source code.
 */
export async function findOrphanKeys(opts: {
  layer?: string
  locale?: string
  scanDirs?: string[]
  excludeDirs?: string[]
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const { layersToCheck, keysByLayer, totalKeys, localeCode } = await resolveOrphanScanContext(config, {
    layer,
    locale,
    dir,
    toolName: 'find_orphan_keys',
  })

  if (totalKeys === 0) {
    const emptyOutput = { orphanKeys: {} as Record<string, string[]>, summary: { totalKeys: 0, orphanCount: 0, filesScanned: 0, message: 'No translation keys found in locale files.' } }
    const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
    if (reportPath) {
      await writeReportFile(reportPath, emptyOutput, {
        tool: 'find_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs },
      })
      return { reportFile: reportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await findOrphanKeysForConfig({
    keysByLayer,
    scanDirs: scanDirs || [dir],
    excludeDirs: excludeDirs || undefined,
    resolveIgnorePatterns: (layerName) => resolveOrphanIgnorePatterns(config, layerName),
    patterns: getPatternSet(config.localeFileFormat),
  })

  const byLayer = orphanResult.orphansByLayer
  const allOrphanKeys: Array<{ key: string; layer: string }> = []
  for (const [layerName, keys] of Object.entries(byLayer)) {
    for (const key of keys) allOrphanKeys.push({ key, layer: layerName })
  }
  allOrphanKeys.sort((a, b) => a.layer.localeCompare(b.layer) || a.key.localeCompare(b.key))
  const sortedByLayer: Record<string, string[]> = {}
  for (const { key, layer: keyLayer } of allOrphanKeys) {
    if (!sortedByLayer[keyLayer]) sortedByLayer[keyLayer] = []
    sortedByLayer[keyLayer].push(key)
  }

  const output: Record<string, unknown> = {
    orphanKeys: sortedByLayer,
    uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
    summary: {
      totalKeys,
      orphanCount: orphanResult.orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      dynamicMatchedCount: orphanResult.dynamicMatchedCount,
      ignoredCount: orphanResult.ignoredCount,
      usedCount: totalKeys - orphanResult.orphanCount - orphanResult.uncertainCount,
      filesScanned: orphanResult.totalFilesScanned,
      layersChecked: layersToCheck.map(d => d.layer),
      dirsScanned: orphanResult.dirsScanned,
      locale: localeCode,
    },
    dynamicKeyWarning: orphanResult.allDynamicKeys.length > 0
      ? `${orphanResult.allDynamicKeys.length} dynamic key reference(s) found (template literals with interpolation). Some "orphan" keys may actually be used via dynamic keys. Review before removing. Note: string concatenation patterns (e.g. 'prefix.' + var) are not detected — use template literals for full coverage.`
      : undefined,
    dynamicKeys: orphanResult.allDynamicKeys.length > 0
      ? orphanResult.allDynamicKeys.map(dk => ({
          expression: dk.expression,
          file: toRelativePath(dk.file, dir),
          line: dk.line,
        }))
      : undefined,
    unresolvedKeyWarnings: orphanResult.unresolvedKeyWarnings.length > 0
      ? orphanResult.unresolvedKeyWarnings.map(w => ({
          expression: w.expression,
          file: toRelativePath(w.file, dir),
          line: w.line,
          callee: w.callee,
          suggestedIgnorePattern: w.suggestedIgnorePattern,
        }))
      : undefined,
  }

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'find_orphan_keys',
      args: { layer, locale, scanDirs, excludeDirs },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Scan Vue/TS source files to find where translation keys are referenced.
 */
export async function scanCodeUsage(opts: {
  keys?: string[]
  scanDirs?: string[]
  excludeDirs?: string[]
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { keys, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const dirsToScan = scanDirs ?? config.layerRootDirs

  const allUsages: Array<{ key: string; file: string; line: number; callee: string }> = []
  const allDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }> = []
  let totalFilesScanned = 0

  for (const scanDir of dirsToScan) {
    const result = await scanSourceFiles(scanDir, excludeDirs, getPatternSet(config.localeFileFormat))
    totalFilesScanned += result.filesScanned
    allUsages.push(...result.usages)
    allDynamicKeys.push(...result.dynamicKeys)
  }

  const filteredUsages = keys
    ? allUsages.filter(u => keys.includes(u.key))
    : allUsages

  const byKey: Record<string, Array<{ file: string; line: number; callee: string }>> = {}
  for (const usage of filteredUsages) {
    if (!byKey[usage.key]) byKey[usage.key] = []
    byKey[usage.key].push({
      file: toRelativePath(usage.file, dir),
      line: usage.line,
      callee: usage.callee,
    })
  }

  const sortedByKey: Record<string, Array<{ file: string; line: number; callee: string }>> = {}
  for (const key of Object.keys(byKey).sort()) {
    sortedByKey[key] = byKey[key]
  }

  const notFound = keys
    ? keys.filter(k => !byKey[k])
    : []

  const output: Record<string, unknown> = {
    usages: sortedByKey,
    summary: {
      uniqueKeysFound: Object.keys(sortedByKey).length,
      totalReferences: filteredUsages.length,
      filesScanned: totalFilesScanned,
      dirsScanned: dirsToScan,
    },
  }

  if (notFound.length > 0) {
    output.notFoundInCode = notFound
  }

  if (allDynamicKeys.length > 0) {
    output.dynamicKeys = allDynamicKeys.map(dk => ({
      expression: dk.expression,
      file: toRelativePath(dk.file, dir),
      line: dk.line,
    }))
  }

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'scan_code_usage')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'scan_code_usage',
      args: { keys, scanDirs, excludeDirs },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Find translation keys not referenced in source code and remove them.
 */
export async function removeOrphanKeys(opts: {
  layer?: string
  locale?: string
  scanDirs?: string[]
  excludeDirs?: string[]
  dryRun?: boolean
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? true

  const { keysByLayer, totalKeys } = await resolveOrphanScanContext(config, {
    layer,
    locale,
    dir,
    toolName: 'remove_orphan_keys',
  })

  if (totalKeys === 0) {
    const emptyOutput = { orphanKeys: {}, removed: {}, summary: { totalKeys: 0, orphanCount: 0, message: 'No translation keys found.' } }
    const emptyReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (emptyReportPath) {
      validateReportPath(dir, emptyReportPath)
      await writeReportFile(emptyReportPath, emptyOutput, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: emptyReportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await findOrphanKeysForConfig({
    keysByLayer,
    scanDirs: scanDirs || [dir],
    excludeDirs: excludeDirs || undefined,
    resolveIgnorePatterns: (layerName) => resolveOrphanIgnorePatterns(config, layerName),
    patterns: getPatternSet(config.localeFileFormat),
  })
  const orphansByLayer = orphanResult.orphansByLayer
  const orphanCount = orphanResult.orphanCount
  const totalFilesScanned = orphanResult.totalFilesScanned
  const dynamicMatchedCount = orphanResult.dynamicMatchedCount
  const ignoredCount = orphanResult.ignoredCount
  const allDynamicKeys = orphanResult.allDynamicKeys.map(dk => ({
    expression: dk.expression,
    file: toRelativePath(dk.file, dir),
    line: dk.line,
  }))

  if (orphanCount === 0) {
    const messageParts: string[] = ['No orphan keys found.']
    if (dynamicMatchedCount > 0) messageParts.push(`${dynamicMatchedCount} key(s) were excluded by dynamic pattern matching.`)
    if (ignoredCount > 0) messageParts.push(`${ignoredCount} key(s) were excluded by ignore patterns.`)
    if (orphanResult.uncertainCount > 0) messageParts.push(`${orphanResult.uncertainCount} uncertain key(s) were excluded because they overlap with dynamic translation patterns.`)
    if (dynamicMatchedCount === 0 && ignoredCount === 0 && orphanResult.uncertainCount === 0) messageParts.push('All translation keys are referenced in code.')
    const zeroOutput: Record<string, unknown> = {
      orphanKeys: {},
      uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
      summary: { totalKeys, orphanCount: 0, uncertainCount: orphanResult.uncertainCount, dynamicMatchedCount, ignoredCount, filesScanned: totalFilesScanned, message: messageParts.join(' ') },
    }
    const zeroReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (zeroReportPath) {
      validateReportPath(dir, zeroReportPath)
      await writeReportFile(zeroReportPath, zeroOutput, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: zeroReportPath, summary: zeroOutput.summary }
    }
    return zeroOutput
  }

  // Dry run — just report
  if (isDryRun) {
    const output: Record<string, unknown> = {
      orphanKeys: orphansByLayer,
      uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
      summary: {
        dryRun: true,
        totalKeys,
        orphanCount,
        uncertainCount: orphanResult.uncertainCount,
        dynamicMatchedCount,
        ignoredCount,
        usedCount: totalKeys - orphanCount - orphanResult.uncertainCount,
        filesScanned: totalFilesScanned,
        message: `Found ${orphanCount} orphan key(s) safe to remove.${orphanResult.uncertainCount > 0 ? ` ${orphanResult.uncertainCount} uncertain key(s) excluded (overlap with dynamic translation patterns).` : ''} ${dynamicMatchedCount > 0 ? `${dynamicMatchedCount} key(s) matched dynamic patterns and were excluded. ` : ''}${ignoredCount > 0 ? `${ignoredCount} key(s) matched ignore patterns and were excluded. ` : ''}Call again with dryRun: false to remove them.`,
      },
    }
    if (allDynamicKeys.length > 0) {
      output.dynamicKeyWarning = `${allDynamicKeys.length} dynamic key reference(s) found. Some "orphan" keys may be used via dynamic keys. Review before removing. Note: string concatenation patterns (e.g. 'prefix.' + var) are not detected — use template literals for full coverage.`
      output.dynamicKeys = allDynamicKeys
    }
    if (orphanResult.unresolvedKeyWarnings.length > 0) {
      output.unresolvedKeyWarnings = orphanResult.unresolvedKeyWarnings.map(w => ({
        expression: w.expression,
        file: toRelativePath(w.file, dir),
        line: w.line,
        callee: w.callee,
        suggestedIgnorePattern: w.suggestedIgnorePattern,
      }))
    }
    const dryRunReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (dryRunReportPath) {
      validateReportPath(dir, dryRunReportPath)
      await writeReportFile(dryRunReportPath, output, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: dryRunReportPath, summary: output.summary }
    }
    return output
  }

  // Actual removal
  const removedByLayer: Record<string, string[]> = {}
  let totalFilesWritten = 0

  for (const [layerName, orphans] of Object.entries(orphansByLayer)) {
    const ld = config.localeDirs.find(d => d.layer === layerName)!
    if (ld.aliasOf) continue

    for (const localeDef2 of config.locales) {
      try {
        const written = await mutateLocaleData(config, layerName, localeDef2, (fileData) => {
          for (const key of orphans) {
            removeNestedValue(fileData, key)
          }
        })
        totalFilesWritten += written.size
      } catch {
        continue
      }
    }

    removedByLayer[layerName] = orphans
  }

  const removalOutput: Record<string, unknown> = {
    removed: removedByLayer,
    uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
    summary: {
      dryRun: false,
      totalKeys,
      removedCount: orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      dynamicMatchedCount,
      ignoredCount,
      remainingCount: totalKeys - orphanCount,
      filesWritten: totalFilesWritten,
      filesScanned: totalFilesScanned,
    },
  }

  const removalReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
  if (removalReportPath) {
    validateReportPath(dir, removalReportPath)
    await writeReportFile(removalReportPath, removalOutput, {
      tool: 'remove_orphan_keys',
      args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
    })
    return { reportFile: removalReportPath, summary: removalOutput.summary }
  }

  return removalOutput
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

  return {
    created: result.created.map(f => ({
      locale: f.locale,
      layer: f.layer,
      file: toRelativePath(f.file, config.rootDir),
      keys: f.keys,
      ...(f.namespace ? { namespace: f.namespace } : {}),
    })),
    skipped: result.skipped.map(f => ({
      locale: f.locale,
      layer: f.layer,
      file: toRelativePath(f.file, config.rootDir),
      keys: f.keys,
      ...(f.namespace ? { namespace: f.namespace } : {}),
    })),
    dryRun: opts.dryRun ?? false,
  }
}

// ─── list_namespaces ────────────────────────────────────────────

export interface NamespaceNode {
  keyCount: number
  children?: Record<string, NamespaceNode>
}

export interface ListNamespacesResult {
  layers: Record<string, { namespaces: Record<string, NamespaceNode> }>
}

/**
 * Build a prefix tree of all translation keys grouped by layer and namespace.
 * Useful for agents to browse available keys without guesswork.
 */
export async function listNamespaces(opts: {
  layer?: string
  locale?: string
  projectDir?: string
}): Promise<ListNamespacesResult> {
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  // Validate and resolve layers
  if (opts.layer && opts.layer !== '*') {
    findLayerOrThrow(config, opts.layer)
  }
  const layersToScan = (opts.layer && opts.layer !== '*')
    ? config.localeDirs.filter(d => d.layer === opts.layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  // Resolve locale: validate explicit, default to configured default locale
  const localeToUse = opts.locale
    ? findLocaleImpl(config, opts.locale) ?? (() => {
        throw new ToolError(`Locale not found: "${opts.locale}". Available: ${config.locales.map(l => l.code).join(', ')}.`, 'LOCALE_NOT_FOUND')
      })()
    : findLocaleImpl(config, config.defaultLocale) ?? config.locales[0]

  if (!localeToUse) {
    throw new ToolError('No locales found in configuration.', 'LOCALE_NOT_FOUND')
  }

  const layers: Record<string, { namespaces: Record<string, NamespaceNode> }> = {}

  for (const ld of layersToScan) {
    let data: Record<string, unknown>
    try {
      data = await readLocaleData(config, ld.layer, localeToUse)
    }
    catch {
      continue
    }

    const keys = getLeafKeys(data)
    if (keys.length === 0) continue

    const root: NamespaceNode = { keyCount: 0, children: {} }

    for (const key of keys) {
      const segments = key.split('.')
      let node = root
      for (const seg of segments) {
        if (!node.children) node.children = {}
        if (!node.children[seg]) {
          node.children[seg] = { keyCount: 0 }
        }
        node = node.children[seg]
      }
      node.keyCount++ // leaf count at terminal node
    }

    // Propagate leaf counts upward
    propagateCounts(root)

    layers[ld.layer] = { namespaces: root.children ?? {} }
  }

  return { layers }
}

function propagateCounts(node: NamespaceNode): number {
  if (!node.children || Object.keys(node.children).length === 0) {
    return node.keyCount
  }

  let total = 0
  for (const child of Object.values(node.children)) {
    total += propagateCounts(child)
  }
  node.keyCount = total
  return total
}
