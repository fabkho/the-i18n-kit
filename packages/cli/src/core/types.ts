/**
 * Shared result types for all i18n operations.
 * These are plain objects — no MCP content wrappers.
 */

// ─── detect_i18n_config ──────────────────────────────────────────
// Returns I18nConfig directly (re-exported from config/types)
export type { I18nConfig } from '../config/types.js'
import type { LocaleRefAmbiguity } from './shared.js'
export type { LocaleRefAmbiguity } from './shared.js'

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
  /** What failed: placeholder set mismatch (default) or vue-i18n plural
   *  variant-count mismatch. Optional for backwards compatibility. */
  kind?: 'placeholder' | 'plural-count'
  /** Present for kind 'plural-count': variant counts of source and target. */
  sourceVariants?: number
  targetVariants?: number
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

/**
 * A locale ref in the request that matched no known locale. Its values were
 * not written; the keys still appear in `written` because other locales
 * succeeded, so this field is the only signal the write did less than asked.
 */
export interface UnresolvedLocaleRef {
  ref: string
  /** Keys whose value for this ref was dropped. */
  keys: string[]
  /** "Did you mean …?", when a near match exists. */
  suggestion?: string
}

export interface MutationResult {
  applied: string[]
  skipped: string[]
  warnings: string[]
  filesWritten: number
  preview?: MutationPreview[]
  placeholderValidation?: PlaceholderValidationResult
  /** Present only when a ref resolved to nothing. */
  unresolvedLocales?: UnresolvedLocaleRef[]
  /** Present only when a ref matched several locales and precedence picked one. */
  ambiguousLocales?: LocaleRefAmbiguity[]
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
  /** Present only when a locale ref resolved to nothing — see UnresolvedLocaleRef. */
  unresolvedLocales?: UnresolvedLocaleRef[]
  /** Present only when a locale ref matched several locales. */
  ambiguousLocales?: LocaleRefAmbiguity[]
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
  /** Present only when a locale ref resolved to nothing — see UnresolvedLocaleRef. */
  unresolvedLocales?: UnresolvedLocaleRef[]
  /** Present only when a locale ref matched several locales. */
  ambiguousLocales?: LocaleRefAmbiguity[]
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
  /** Present only when a locale ref resolved to nothing — see UnresolvedLocaleRef. */
  unresolvedLocales?: UnresolvedLocaleRef[]
  /** Present only when a locale ref matched several locales. */
  ambiguousLocales?: LocaleRefAmbiguity[]
  placeholderValidation?: PlaceholderValidationResult
  summary?: {
    keysToUpdate: number
    keysSkipped: number
    message: string
  }
  skippedKeys?: string[]
}

// ─── init ────────────────────────────────────────────────────────

/**
 * The config `init` emits. Only fields the matched adapter cannot derive:
 * writing a copy of what the framework already states creates a second source
 * of truth that drifts silently (#305). The generic path is the exception —
 * without localeDirs and defaultLocale nothing resolves at all.
 */
export interface GeneratedProjectConfig {
  $schema: string
  context: string
  glossary: Record<string, string>
  translationPrompt: string
  localeNotes: Record<string, string>
  /** Matches localeDirEntrySchema: a bare path, or a path bound to a layer. */
  localeDirs?: Array<string | { path: string; layer: string }>
  defaultLocale?: string
  locales?: string[]
}

export interface InitProjectConfigResult {
  config: GeneratedProjectConfig
  detected: {
    adapter: string
    label: string
    /** Detection score. 0 when nothing matched and generic was assumed. */
    confidence: number
    /**
     * Whether the matched adapter resolves locales, layers and the default
     * locale from framework config. False only for the generic adapter, which
     * cannot resolve without them written into `.i18n-mcp.json`. Independent
     * of whether this run carried locale settings forward from an existing
     * file under `--force`.
     */
    derivesLocaleConfig: boolean
    /** Other adapters that also scored, best first. */
    runnersUp?: Array<{ name: string; confidence: number }>
    /** Present when init could not find anything to point the config at. */
    note?: string
  }
  /** Path relative to the project dir. */
  configPath: string
  written: boolean
  overwritten: boolean
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

/** How a translate run was (or would be) executed. */
export type TranslateMode = 'provider' | 'agent' | 'dry-run'

/** Why a key could not be translated. */
export type TranslateFailReason =
  | 'provider-error'
  | 'omitted-by-model'
  | 'placeholder-mismatch'
  | 'plural-mismatch'
  | 'write-error'
  | 'truncated'

/** Why a key or locale was intentionally not attempted. */
export type TranslateSkipReason = 'no-provider' | 'already-translated' | 'protected-locale'

export interface TranslateMissingLocaleResult {
  mode: TranslateMode
  /** Number of missing keys found for this locale. Always equals
   *  translated + wouldTranslate + failed + skipped. */
  missing: number
  translated: string[]
  /** Dry-run only: keys that would be translated. */
  wouldTranslate?: string[]
  failed: Array<{ key: string, reason: TranslateFailReason }>
  skipped: Array<{ key: string, reason: TranslateSkipReason }>
  batches?: number
  model?: string
  writeError?: string
  placeholderValidation?: PlaceholderValidationResult
}

export interface TranslateMissingResult {
  results: Record<string, TranslateMissingLocaleResult>
  fallbackContexts?: Record<string, Record<string, unknown>>
  summary: {
    mode: TranslateMode
    totalTranslated: number
    totalFailed: number
    totalSkipped: number
    totalWouldTranslate?: number
    layer: string
    referenceLocale: string | LocaleRefInfo
    targetLocales: Array<string | LocaleRefInfo>
    dryRun: boolean
    /** Surface-owned guidance (set by the CLI command or MCP tool, not the core). */
    message?: string
  }
}

/**
 * Per-layer totals in the all-layers translate summary (`summary.byLayer`).
 * Field names mirror the cross-layer summary totals so consumers parse both
 * with the same accessors. `totalWouldTranslate` is always present (0 outside
 * dry runs).
 */
export interface TranslateLayerTotals {
  layer: string
  totalTranslated: number
  totalFailed: number
  totalSkipped: number
  totalWouldTranslate: number
}

// ─── translate_key ───────────────────────────────────────────────

export interface TranslateKeyLocaleIssue {
  locale: string
  reason: TranslateFailReason | 'read-error'
  detail?: string
}

export interface TranslateKeyResult {
  key: string
  sourceLocale: LocaleRefInfo
  updatedSource: boolean
  mode: TranslateMode
  translated: string[]
  /** Dry-run only: locales that would be translated. */
  wouldTranslate?: string[]
  skipped: Array<{ locale: string, reason: TranslateSkipReason }>
  failed: TranslateKeyLocaleIssue[]
  filesWritten: number
  dryRun: boolean
  model?: string
  placeholderValidation: PlaceholderValidationResult
  preview?: Record<string, string>
  fallbackContext?: Record<string, unknown>
  /** Surface-owned guidance (set by the CLI command or MCP tool, not the core). */
  message?: string
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
  /** True when the provider stopped early (finish/stop reason = token limit).
   *  The response text is incomplete and must not be parsed as a full batch. */
  truncated?: boolean
}

export type TranslateFn = (opts: TranslateRequest) => Promise<TranslateResponse>
export type ProgressFn = (message: string) => Promise<void>
