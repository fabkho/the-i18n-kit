import type { LocaleDefinition } from './types'
import { log } from '../utils/logger'

/**
 * Apply the optional `locales` override from `.i18n-mcp.json` on top of the
 * locales auto-discovered by a framework adapter.
 *
 * Semantics:
 * - If `projectLocales` is unset/empty → return `discovered` unchanged.
 * - Else → restrict to the configured codes, preserving the order from
 *   `projectLocales` and keeping the metadata (file, language, name) from
 *   the discovered entries. Configured codes with no matching discovered
 *   entry get a minimal `{code, language: code}` fallback and a warning.
 */
export function applyLocaleOverride(
  discovered: LocaleDefinition[],
  projectLocales: string[] | undefined,
): LocaleDefinition[] {
  if (!projectLocales || projectLocales.length === 0) {
    return discovered
  }

  const byCode = new Map(discovered.map(l => [l.code, l]))
  const missing: string[] = []

  const result = projectLocales.map((code) => {
    const found = byCode.get(code)
    if (found) return found
    missing.push(code)
    return { code, language: code }
  })

  if (missing.length > 0) {
    log.warn(
      `Configured locales not found in framework auto-detection: ${missing.join(', ')}. `
      + 'Translations for these codes may fail to write — make sure the locale files exist.',
    )
  }

  const dropped = discovered.filter(l => !projectLocales.includes(l.code))
  if (dropped.length > 0) {
    log.debug(
      `Locale override active: dropped ${dropped.length} auto-detected locale(s) `
      + `(${dropped.map(l => l.code).join(', ')})`,
    )
  }

  return result
}
