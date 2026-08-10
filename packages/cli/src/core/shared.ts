/**
 * Shared locale/layer lookup helpers used across the core operation modules.
 */

import type { I18nConfig, LocaleDefinition, LocaleDir } from '../config/types.js'
import { ToolError } from '../utils/errors.js'

import type { LocaleRefInfo } from './types.js'

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

export function findLocaleSuggestion(config: I18nConfig, localeRef: string): string {
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

/**
 * Resolve the reference locale for scan operations: the requested ref or the
 * project default. Throws LOCALE_NOT_FOUND listing the available codes.
 */
export function resolveReferenceLocale(
  config: I18nConfig,
  requested?: string,
): { localeCode: string; localeDef: LocaleDefinition } {
  const localeCode = requested ?? config.defaultLocale
  const localeDef = findLocaleImpl(config, localeCode)
  if (!localeDef) {
    throw new ToolError(
      `Locale not found: "${localeCode}". Available: ${config.locales.map(l => l.code).join(', ')}`,
      'LOCALE_NOT_FOUND',
    )
  }
  return { localeCode, localeDef }
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
