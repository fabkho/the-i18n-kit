/**
 * Shared result types for all i18n operations.
 * These are plain objects — no MCP content wrappers.
 */

// ─── detect_i18n_config ──────────────────────────────────────────
// Returns I18nConfig directly (re-exported from config/types)
export type { I18nConfig } from '../config/types.js'

// ─── list_locale_dirs ────────────────────────────────────────────

export interface LocaleDirInfo {
  layer: string
  path: string
  aliasOf?: string
  fileCount: number
  topLevelKeys?: string[]
  namespaces?: string[]
}

// ─── get_translations ────────────────────────────────────────────
// Returns Record<string, Record<string, unknown>>
// (locale code → key → value)

// ─── add / update translations ───────────────────────────────────

export interface MutationPreview {
  locale: string
  key: string
  value: string
}

export interface PlaceholderValidationIssue {
  locale: string
  key: string
  missing: string[]
  extra: string[]
}

export interface PlaceholderValidationResult {
  ok: boolean
  placeholders: string[]
  errors: PlaceholderValidationIssue[]
}

export interface LocaleRefInfo {
  code: string
  language?: string
  file?: string
  name?: string
}

export interface MutationResult {
  applied: string[]
  skipped: string[]
  warnings: string[]
  filesWritten: number
  preview?: MutationPreview[]
  placeholderValidation?: PlaceholderValidationResult
}

export interface AddTranslationsResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldAdd?: MutationPreview[]
  /** Present when dryRun=false */
  added?: string[]
  skipped: string[]
  filesWritten?: number
  warnings?: string[]
  placeholderValidation?: PlaceholderValidationResult
  summary?: {
    keysToAdd: number
    keysSkipped: number
    message: string
  }
  skippedKeys?: string[]
}

export interface WriteTranslationsResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldWrite?: MutationPreview[]
  /** Present when dryRun=false */
  written?: string[]
  skipped: string[]
  filesWritten?: number
  warnings?: string[]
  placeholderValidation?: PlaceholderValidationResult
  summary?: {
    keysWritten: number
    keysSkipped: number
    message: string
  }
  skippedKeys?: string[]
}

export interface UpdateTranslationsResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldUpdate?: MutationPreview[]
  /** Present when dryRun=false */
  updated?: string[]
  skipped: string[]
  filesWritten?: number
  placeholderValidation?: PlaceholderValidationResult
  summary?: {
    keysToUpdate: number
    keysSkipped: number
    message: string
  }
  skippedKeys?: string[]
}

// ─── get_missing_translations ────────────────────────────────────

export interface MissingTranslationsResult {
  missing: Record<string, Record<string, string[]>>
  summary: {
    referenceLocale: string | LocaleRefInfo
    targetLocales: Array<string | LocaleRefInfo>
    layersScanned: string[]
    totalMissingKeys: number
  }
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── find_empty_translations ─────────────────────────────────────

export interface EmptyTranslationsResult {
  emptyKeys: Record<string, Record<string, string[]>>
  summary: {
    totalEmpty: number
    localesChecked: string[]
    layersChecked: string[]
  }
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── search_translations ─────────────────────────────────────────

export interface SearchMatch {
  layer: string
  locale: string
  key: string
  value: unknown
}

export interface SearchTranslationsResult {
  matches: SearchMatch[]
  totalMatches: number
}

// ─── remove_translations ─────────────────────────────────────────

export interface RemoveTranslationsPreview {
  locale: string
  key: string
  oldValue: unknown
}

export interface RemoveTranslationsResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldRemove?: RemoveTranslationsPreview[]
  /** Present when dryRun=false */
  removed?: string[]
  removedPerLocale?: string[]
  notFound?: string[]
  filesWritten?: number
  summary?: {
    keysFound: number
    message: string
  }
}

// ─── rename_translation_key ──────────────────────────────────────

export interface RenameTranslationKeyPreview {
  locale: string
  oldKey: string
  newKey: string
  value: unknown
}

export interface RenameTranslationKeyResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldRename?: RenameTranslationKeyPreview[]
  /** Present when dryRun=false */
  renamed?: string[]
  filesWritten?: number
  oldKey?: string
  newKey?: string
  notFoundInLocales?: string[]
  conflictsInLocales?: string[]
  skippedDueToConflict?: string[]
  summary?: {
    localesAffected: number
    message: string
    warning?: string
  }
}

// ─── translate_missing ───────────────────────────────────────────

export interface TranslateMissingLocaleResult {
  translated: string[]
  failed: string[]
  samplingUsed: boolean
  reason?: 'no-missing-keys' | 'dry-run' | 'translated-with-sampling' | 'sampling-unavailable'
  batches?: number
  model?: string
  writeError?: string
  placeholderValidation?: PlaceholderValidationResult
}

export interface TranslateMissingResult {
  results: Record<string, TranslateMissingLocaleResult>
  fallbackContexts?: Record<string, Record<string, unknown>>
  summary: {
    samplingSupported: boolean
    totalTranslated: number
    totalFailed: number
    layer: string
    referenceLocale: string | LocaleRefInfo
    targetLocales: Array<string | LocaleRefInfo>
    dryRun: boolean
    message?: string
  }
}

// ─── translate_key ───────────────────────────────────────────────

export interface TranslateKeyFailure {
  locale: string
  error: string
}

export interface TranslateKeyResult {
  key: string
  sourceLocale: LocaleRefInfo
  updatedSource: boolean
  translated: string[]
  skipped: string[]
  failed: Array<string | TranslateKeyFailure>
  filesWritten: number
  dryRun: boolean
  samplingUsed: boolean
  reason?: 'dry-run' | 'translated-with-sampling' | 'sampling-unavailable'
  model?: string
  placeholderValidation: PlaceholderValidationResult
  preview?: Record<string, string>
  fallbackContext?: Record<string, unknown>
}

// ─── find_orphan_keys ────────────────────────────────────────────

export interface DynamicKeyRef {
  expression: string
  file: string
  line: number
}

export interface UnresolvedKeyWarningRef {
  expression: string
  file: string
  line: number
  callee: string
  suggestedIgnorePattern?: string
}

export interface FindOrphanKeysResult {
  orphanKeys: Record<string, string[]>
  uncertainKeys?: Record<string, string[]>
  summary: {
    totalKeys: number
    orphanCount: number
    uncertainCount?: number
    dynamicMatchedCount?: number
    ignoredCount?: number
    usedCount?: number
    filesScanned: number
    layersChecked?: string[]
    dirsScanned?: string[]
    locale?: string
    message?: string
  }
  dynamicKeyWarning?: string
  dynamicKeys?: DynamicKeyRef[]
  unresolvedKeyWarnings?: UnresolvedKeyWarningRef[]
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── scan_code_usage ─────────────────────────────────────────────

export interface CodeUsageRef {
  file: string
  line: number
  callee: string
}

export interface ScanCodeUsageResult {
  usages: Record<string, CodeUsageRef[]>
  summary: {
    uniqueKeysFound: number
    totalReferences: number
    filesScanned: number
    dirsScanned: string[]
  }
  notFoundInCode?: string[]
  dynamicKeys?: DynamicKeyRef[]
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── remove_orphan_keys ─────────────────────────────────

export interface RemoveOrphanKeysResult {
  orphanKeys?: Record<string, string[]>
  removed?: Record<string, string[]>
  uncertainKeys?: Record<string, string[]>
  summary: {
    dryRun?: boolean
    totalKeys: number
    orphanCount?: number
    removedCount?: number
    uncertainCount?: number
    dynamicMatchedCount?: number
    ignoredCount?: number
    usedCount?: number
    remainingCount?: number
    filesScanned?: number
    filesWritten?: number
    message?: string
  }
  dynamicKeyWarning?: string
  dynamicKeys?: DynamicKeyRef[]
  unresolvedKeyWarnings?: UnresolvedKeyWarningRef[]
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── scaffold_locale ─────────────────────────────────────────────

export interface ScaffoldLocaleFileInfo {
  locale: string
  layer: string
  file: string
  keys: number
  namespace?: string
}

export interface ScaffoldLocaleResult {
  created: ScaffoldLocaleFileInfo[]
  skipped: ScaffoldLocaleFileInfo[]
  dryRun: boolean
}

// ─── Translation backend callback types ──────────────────────────

export interface TranslateRequest {
  systemPrompt: string
  userMessage: string
  maxTokens: number
}

export interface TranslateResponse {
  text: string
  model: string
}

export type TranslateFn = (opts: TranslateRequest) => Promise<TranslateResponse>
export type ProgressFn = (message: string) => Promise<void>
