// Public API — re-export everything the MCP package (and other consumers) need

// Core operations
export {
  detectConfig,
  listLocaleDirs,
  getTranslations,
  writeTranslations,
  addTranslations,
  updateTranslations,
  getMissingTranslations,
  getTranslationStatus,
  findEmptyTranslations,
  searchTranslations,
  removeTranslations,
  renameTranslationKey,
  moveTranslationKey,
  translateMissing,
  translateKey,
  findOrphanKeys,
  scanCodeUsage,
  removeOrphanKeys,
  findDuplicateKeys,
  checkUndefinedKeys,
  scaffoldLocaleFiles,
  listNamespaces,
  findLocaleImpl,
  resolveProtectedLocales,
} from './core/operations.js'
export type {
  DuplicateKeyCollision,
  FindDuplicateKeysResult,
  FindDuplicateKeysSummary,
  KeyUsageLocation,
  UndefinedKeyFinding,
  UncertainKeyFinding,
  CheckUndefinedKeysResult,
  CheckUndefinedKeysSummary,
} from './core/operations.js'

// Core types
export * from './core/types.js'

// Config
export { detectI18nConfig, getCachedConfig, clearConfigCache } from './config/detector.js'
export type { I18nConfig, LocaleDefinition, LocaleDir, ProjectConfig } from './config/types.js'
export { buildLayerGraph, serializeLayerGraph } from './config/layer-graph.js'
export type { LayerGraph, SerializedLayerGraph } from './config/layer-graph.js'
// Exported for the scanner differential harness (#332).
export { scanSourceFiles } from './scanner/code-scanner.js'

// IO
export { readLocaleData } from './io/locale-data.js'

// Errors
export { ToolError, toErrorMessage } from './utils/errors.js'
export { renameNotice } from './utils/rename-notice.js'

// LLM providers
export { createTranslateFn, TranslateProviderError, classifyProviderError, resolveProviderBaseUrl, BASE_URL_ENV } from './llm/providers.js'
export { loadProjectConfig } from './config/project-config.js'
export { defineI18nKitConfig } from './define-config.js'
export type { I18nKitConfig } from './define-config.js'
export type { LlmProvider, LlmProviderConfig, TranslateProviderErrorKind } from './llm/providers.js'
