/**
 * Core i18n operations — pure async functions with no MCP dependency.
 *
 * This module is a barrel: the implementations live in the cohesive
 * modules below, and every symbol operations.ts historically exported is
 * re-exported here so consumers keep a single stable import path.
 *
 * Each function accepts plain parameters and returns plain objects.
 * Errors are thrown (ToolError etc.) rather than returned as isError responses.
 */

export {
  findLayerOrThrow,
  localeRefInfo,
  findLocaleImpl,
  findLocaleOrThrow,
} from './shared.js'

export {
  validateReportPath,
  resolveReportFilePath,
} from './report.js'

export {
  computeMaxTokens,
  computeProgressTotal,
  resolveProtectedLocales,
  extractPlaceholders,
  validatePlaceholders,
  buildTranslationSystemPrompt,
  buildTranslationUserMessage,
  extractJsonFromResponse,
  buildFallbackContext,
  translateMissing,
  translateKey,
} from './ops-translate.js'

export {
  detectConfig,
  listLocaleDirs,
  getTranslations,
  getMissingTranslations,
  findEmptyTranslations,
  searchTranslations,
  listNamespaces,
} from './ops-read.js'

export type {
  NamespaceNode,
  ListNamespacesResult,
} from './ops-read.js'

export {
  applyTranslations,
  writeTranslations,
  addTranslations,
  updateTranslations,
  removeTranslations,
  renameTranslationKey,
  scaffoldLocaleFiles,
} from './ops-write.js'

export {
  resolveOrphanIgnorePatterns,
  findOrphanKeys,
  scanCodeUsage,
  removeOrphanKeys,
} from './ops-orphans.js'
