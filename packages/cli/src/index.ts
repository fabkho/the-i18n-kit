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
  findEmptyTranslations,
  searchTranslations,
  removeTranslations,
  renameTranslationKey,
  translateMissing,
  translateKey,
  findOrphanKeys,
  scanCodeUsage,
  scanKeys,
  cleanupUnusedTranslations,
  scaffoldLocaleFiles,
  findLocaleImpl,
} from './core/operations.js'

// Core types
export * from './core/types.js'

// Config
export { detectI18nConfig, getCachedConfig } from './config/detector.js'
export type { I18nConfig, LocaleDefinition, LocaleDir, ProjectConfig } from './config/types.js'

// IO
export { readLocaleData } from './io/locale-data.js'

// Errors
export { ToolError } from './utils/errors.js'

// LLM providers
export { createSamplingFn } from './llm/providers.js'
export type { LlmProvider, LlmProviderConfig } from './llm/providers.js'
