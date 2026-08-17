/**
 * The entry point a project's own `i18n-kit.config.ts` imports:
 *
 * ```ts
 * import { defineI18nKitConfig } from '@the-i18n-kit/cli/config'
 *
 * export default defineI18nKitConfig({ defaultLocale: 'en' })
 * ```
 *
 * Deliberately its own entry rather than part of the package's main export.
 * This module is loaded *by the config file the CLI is about to read*, so it
 * has to stay free of anything that touches the filesystem, the logger, or a
 * provider — importing it must not be able to do anything.
 */
import type { ProjectConfig } from './config/types.js'

/**
 * Everything `.i18n-mcp.json` accepts, minus the JSON-only `$schema` key —
 * a TypeScript config is checked by the editor rather than by a schema URL.
 */
export type I18nKitConfig = ProjectConfig

/**
 * Identity at runtime; the point is the type. Returning the argument unchanged
 * keeps the config file's inferred type exact, so `defaultLocale` autocompletes
 * and a misspelled `protectedLocals` is a red squiggle rather than a key that
 * silently protects nothing.
 */
export function defineI18nKitConfig(config: I18nKitConfig): I18nKitConfig {
  return config
}

export type { ProjectConfig, LocaleDefinition, LocaleDir, I18nConfig } from './config/types.js'
