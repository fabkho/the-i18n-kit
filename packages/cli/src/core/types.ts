/**
 * Shared result types for all i18n operations.
 * These are plain objects — no MCP content wrappers.
 */

// ─── discover ────────────────────────────────────────────────────
// Returns I18nConfig directly (re-exported from config/types)
export type { I18nConfig } from '../config/types.js'
import type { I18nConfig } from '../config/types.js'
import type { SerializedLayerGraph } from '../config/layer-graph.js'
import type { LocaleRefAmbiguity } from './shared.js'
export type { LocaleRefAmbiguity } from './shared.js'

/**
 * The whole resolved project in one answer: the config, the locale dirs behind
 * it, the topology those dirs form, and which locales are maintained by hand.
 *
 * A superset of `I18nConfig` rather than a wrapper around it, because every
 * caller of the old three-call sequence merged the parts anyway and a nested
 * `config` key would break each of them for nothing.
 */
export interface DescribeProjectResult extends I18nConfig {
  /**
   * Canonical codes of the locales the translate operations leave alone. The
   * raw refs stay visible under `projectConfig.protectedLocales`.
   */
  protectedLocales: string[]
  /** One entry per locale directory, with file counts and key namespaces. */
  layers: LocaleDirInfo[]
  /**
   * Which layers are shared, which apps consume which layer, and what each
   * alias points at — the topology behind the flat `layers` list, and what
   * answers where a new key belongs.
   */
  layerGraph: SerializedLayerGraph
}

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

// ─── write translations ──────────────────────────────────────────

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
  /** Absent when the full report went to `reportFile` instead. */
  missing?: Record<string, Record<string, string[]>>
  summary: {
    referenceLocale: string | LocaleRefInfo
    targetLocales: Array<string | LocaleRefInfo>
    layersScanned: string[]
    totalMissingKeys: number
  }
  /** Present when reportOutput is configured */
  reportFile?: string
}

// ─── status ──────────────────────────────────────────────────────

export interface LocaleStatus extends LocaleRefInfo {
  total: number
  translated: number
  missing: number
  /** Present but empty-string — scaffolded and never filled. */
  empty: number
  completion: number
  /** Listed in protectedLocales: maintained by hand. */
  protected?: true
  /** Protected locales are reported but kept out of the overall figure. */
  excludedFromOverall?: true
}

export interface LayerStatus {
  layer: string
  total: number
  translated: number
  missing: number
  empty: number
  completion: number
}

export interface TranslationStatusSummary {
  referenceLocale: LocaleRefInfo
  layersScanned: string[]
  localesChecked: number
  protectedLocales: string[]
  totalKeys: number
  translatedKeys: number
  missingKeys: number
  emptyKeys: number
  /** Overall completion, protected locales excluded. Read by --fail-under. */
  completionPercent: number
}

export interface TranslationStatusResult {
  locales?: LocaleStatus[]
  layers?: LayerStatus[]
  /**
   * Locale → layer → the keys whose value is an empty string. Present only when
   * the caller asked to list them; `summary.emptyKeys` counts them either way.
   * Added to the result rather than replacing it, so asking which keys are
   * empty still answers the coverage question that prompted it.
   */
  empty?: Record<string, Record<string, string[]>>
  summary: TranslationStatusSummary
  /** Present when the full breakdown went to a file instead. */
  reportFile?: string
}

// ─── empty translations ────────────────────────────────────────────

export interface EmptyTranslationsResult {
  /** Absent when the full report went to `reportFile` instead. */
  emptyKeys?: Record<string, Record<string, string[]>>
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

/** What a move does to one locale's copy of the key. */
export interface MoveTranslationKeyPlanEntry {
  locale: string
  value: unknown
  /**
   * `move` writes the target and drops the source. `deduplicate` finds the
   * target already holding the same value, so only the source is dropped.
   */
  action: 'move' | 'deduplicate'
}

/**
 * What a move returns: a rename result when the key stayed in its layer, a move
 * result when it changed layers. A union rather than one merged shape, so
 * neither half carries fields that can never be set for the other.
 */
export type MoveTranslationKeyOutcome = MoveTranslationKeyResult | RenameTranslationKeyResult

export interface MoveTranslationKeyResult {
  /** Present when dryRun=true */
  dryRun?: boolean
  wouldMove?: MoveTranslationKeyPlanEntry[]
  /** Present when dryRun=false */
  movedLocales?: string[]
  /** Locales where the target already held this value, so only the source was dropped. */
  deduplicatedLocales?: string[]
  filesWritten?: number
  fromLayer?: string
  toLayer?: string
  key?: string
  newKey?: string
  /** Locales whose source layer does not define the key at all. */
  notFoundInLocales?: string[]
  /** Locales where the target holds a different value. Nothing is written when this is non-empty. */
  conflictsInLocales?: string[]
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

/** One locale's digest in compact mode: counts rather than key lists. */
export interface TranslateMissingCompactEntry {
  locale: string
  mode: TranslateMode
  missing: number
  translated: number
  failed: number
  skipped: number
  wouldTranslate?: number
  batches?: number
  model?: string
  writeError?: string
}

export interface TranslateMissingResult {
  /** Absent in compact mode, which returns `summary.byLocale` instead. */
  results?: Record<string, TranslateMissingLocaleResult>
  fallbackContexts?: Record<string, Record<string, unknown>>
  summary: {
    /** Compact mode only: a per-locale digest in place of full `results`. */
    byLocale?: TranslateMissingCompactEntry[]
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
/** Aggregated summary across every locale-backed layer. */
export interface TranslateAllLayersSummary {
  mode: TranslateMode
  totalTranslated: number
  totalFailed: number
  totalSkipped: number
  totalWouldTranslate?: number
  /** Layer names that were translated. */
  layers: string[]
  byLayer: TranslateLayerTotals[]
  dryRun: boolean
  referenceLocale?: string | LocaleRefInfo
  targetLocales?: Array<string | LocaleRefInfo>
  /** Surface-owned guidance (set by the CLI command or MCP tool). */
  message?: string
}

/**
 * All-layers mode (`--layer` omitted): one result per layer plus an aggregated
 * summary. Discriminate with `'layers' in result` — both members carry a
 * `summary`, and both summaries carry `mode`, so mode checks need no narrowing.
 */
export interface TranslateAllLayersResult {
  layers: Record<string, TranslateMissingResult>
  summary: TranslateAllLayersSummary
}

/** What translateMissing returns: depends on whether a layer was named. */
export type TranslateMissingOutcome = TranslateMissingResult | TranslateAllLayersResult

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

/** A key referenced only from apps outside its layer's consumption scope. */
export interface MisplacedUsageRef {
  key: string
  /** Layer the key is defined in. */
  layer: string
  /** Out-of-scope scan units (apps or layers) where the key was found. */
  usingApps: string[]
}

export interface DynamicKeyRef {
  expression: string
  /** Absent for context-free bare candidates, which have no single call site. */
  file?: string
  line?: number
}

export interface UnresolvedKeyWarningRef {
  expression: string
  file: string
  line: number
  callee: string
  suggestedIgnorePattern?: string
}

export interface FindOrphanKeysResult {
  /** Absent when the full report went to `reportFile` instead. */
  orphanKeys?: Record<string, string[]>
  uncertainKeys?: Record<string, string[]>
  /**
   * Keys kept alive solely by the bare-candidate net — nothing a frontend
   * could call a usage references them; a dotted string somewhere (a comment,
   * a data structure) merely shares their name. Not orphans, but where dead
   * references hide.
   */
  candidateOnlyKeys?: Record<string, string[]>
  candidateOnlyNote?: string
  /** Keys used only from apps that do not consume the owning layer. */
  misplacedUsages?: MisplacedUsageRef[]
  misplacedUsageNote?: string
  summary: {
    totalKeys: number
    orphanCount: number
    uncertainCount?: number
    candidateOnlyCount?: number
    misplacedCount?: number
    dynamicMatchedCount?: number
    ignoredCount?: number
    usedCount?: number
    filesScanned: number
    /** Files a syntax frontend declined; pattern matching read them instead. */
    filesDeclined?: number
    layersChecked?: string[]
    dirsScanned?: string[]
    scanScope?: Record<string, string[]>
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

/** Where each requested key is referenced in source. */
export interface CodeUsageResult {
  /** Absent when the full report went to `reportFile` instead. */
  usages?: Record<string, CodeUsageRef[]>
  /** Requested keys with no reference anywhere in the scanned source. */
  notFoundInCode?: string[]
  /** Dynamic expressions that could reach the requested keys. */
  dynamicKeys?: DynamicKeyRef[]
  summary: {
    uniqueKeysFound: number
    totalReferences: number
    filesScanned: number
    /** Files a syntax frontend declined; pattern matching read them instead. */
    filesDeclined?: number
    dirsScanned?: string[]
    message?: string
  }
  /** Present when the full report went to a file instead. */
  reportFile?: string
}

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
    /** Files a syntax frontend declined; pattern matching read them instead. */
    filesDeclined?: number
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
  misplacedUsages?: MisplacedUsageRef[]
  misplacedUsageNote?: string
  summary: {
    dryRun?: boolean
    totalKeys: number
    orphanCount?: number
    removedCount?: number
    uncertainCount?: number
    misplacedCount?: number
    dynamicMatchedCount?: number
    ignoredCount?: number
    usedCount?: number
    remainingCount?: number
    filesScanned?: number
    filesWritten?: number
    layersChecked?: string[]
    dirsScanned?: string[]
    scanScope?: Record<string, string[]>
    locale?: string
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
