/**
 * Read-only operations: project discovery, config detection, locale-dir
 * listing, translation lookup/search, missing/empty detection, and namespace
 * browsing.
 */

import { readdir } from 'node:fs/promises'

import { detectI18nConfig, clearConfigCache } from '../config/detector.js'
import { serializeLayerGraph } from '../config/layer-graph.js'
import type { I18nConfig } from '../config/types.js'
import { readLocaleData, readLocaleDataIfPresent, resolveLocaleEntries } from '../io/locale-data.js'
import { getFormat } from '../io/formats.js'
import { getNestedValue, getLeafKeys } from '../io/key-operations.js'
import { ToolError } from '../utils/errors.js'

import type {
  DescribeProjectResult,
  LocaleDirInfo,
  MissingTranslationsResult,
  EmptyTranslationsResult,
  SearchKeyMatch,
  SearchMatch,
  SearchMatchMode,
  SearchTranslationsResult,
} from './types.js'
import { findLayerOrThrow, findReferenceLocaleOrThrow, findLocaleImpl, localeRefInfo, resolveLayersToScan } from './shared.js'
import { resolveProtectedLocales } from './ops-translate.js'

/**
 * Everything a caller needs to know about a project before touching it:
 * resolved config, locale directories, the layer topology, and which locales
 * are hand-maintained.
 *
 * This composition used to live in the MCP `discover` handler, so the terminal
 * had no way to ask the question its own docs told people to ask — and the two
 * surfaces would have had to be kept in step by hand once one of them grew a
 * field. Callers add whatever is theirs alone (the MCP server adds the
 * translation backend it resolved at startup); the project half is here.
 */
export async function describeProject(opts: {
  projectDir?: string
} = {}): Promise<DescribeProjectResult> {
  // detectConfig first: it warms the config cache listLocaleDirs reuses.
  const config = await detectConfig(opts.projectDir)
  const layers = await listLocaleDirs(opts.projectDir)

  return {
    ...config,
    protectedLocales: resolveProtectedLocales(config).map(l => l.code),
    layers,
    layerGraph: serializeLayerGraph(config),
  }
}

/**
 * Detect the i18n configuration from the project, always bypassing the
 * config cache (clears it first).
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
  const format = getFormat(config.localeFileFormat)

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

    // A namespaced layout counts directories and reports the namespaces in
    // one; a flat one counts locale files and reports the keys in one.
    if (format.defaultLayout === 'namespaced') {
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
      const localeFiles = files.filter(f => format.extensions.some(ext => f.toLowerCase().endsWith(ext)))

      let topLevelKeys: string[] = []
      const sampleLocale = config.locales[0]
      if (sampleLocale !== undefined && localeFiles.length > 0) {
        try {
          const data = await readLocaleData(config, localeDir.layer, sampleLocale)
          topLevelKeys = Object.keys(data)
        } catch {}
      }

      results.push({
        layer: localeDir.layer,
        path: localeDir.path,
        fileCount: localeFiles.length,
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
 * Find translation keys that exist in the reference locale but are missing in other locales.
 */
export async function getMissingTranslations(opts: {
  layer?: string
  referenceLocale?: string
  targetLocales?: string[]
  locales?: string[]
  projectDir?: string
}): Promise<MissingTranslationsResult> {
  const { layer } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const refLocale = findReferenceLocaleOrThrow(config, opts.referenceLocale)

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

  const layersToScan = resolveLayersToScan(config, layer)

  const result: Record<string, Record<string, string[]>> = {}
  let totalMissing = 0

  for (const localeDir of layersToScan) {
    const refData = await readLocaleDataIfPresent(config, localeDir.layer, refLocale)
    if (!refData) continue

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
        (result[target.code] ??= {})[localeDir.layer] = missing
        totalMissing += missing.length
      }
    }
  }

  return {
    missing: result,
    summary: {
      referenceLocale: localeRefInfo(refLocale),
      targetLocales: targets.map(localeRefInfo),
      layersScanned: layersToScan.map(d => d.layer),
      totalMissingKeys: totalMissing,
    },
  }
}

/**
 * Find translation keys that have empty string values in locale files.
 */
export async function findEmptyTranslations(opts: {
  layer?: string
  locale?: string
  projectDir?: string
}): Promise<EmptyTranslationsResult> {
  const { layer, locale } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  return collectEmptyTranslations(config, { layer, locale })
}

/**
 * The scan behind {@link findEmptyTranslations}, against a config the caller
 * already has.
 *
 * Separate so `getTranslationStatus` can embed the listing under its own
 * `--list-empty` flag without detecting the project a second time.
 */
export async function collectEmptyTranslations(
  config: I18nConfig,
  opts: { layer?: string, locale?: string },
): Promise<{
  emptyKeys: Record<string, Record<string, string[]>>
  summary: { totalEmpty: number, localesChecked: string[], layersChecked: string[] }
}> {
  const { layer, locale } = opts

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
      const data = await readLocaleDataIfPresent(config, localeDir.layer, loc)
      if (!data) continue

      const leafKeys = getLeafKeys(data)
      const empty = leafKeys.filter(k => getNestedValue(data, k) === '')

      if (empty.length > 0) {
        (emptyKeys[loc.code] ??= {})[localeDir.layer] = empty
        totalEmpty += empty.length
      }
    }
  }

  return {
    emptyKeys,
    summary: {
      totalEmpty,
      localesChecked: localesToCheck.map(l => l.code),
      layersChecked: layersToScan.map(d => d.layer),
    },
  }
}

/**
 * Everything a comparison should ignore when the question is whether a
 * translation for some text already exists: case, accents, punctuation and how
 * much whitespace sits between the words. "Save changes!" and "save  changes"
 * are the same phrase to whoever is deciding whether to reuse the key.
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * How much of two normalized strings is the same words (Sørensen–Dice over
 * tokens). Word order and the words neither side shares are what it ignores,
 * which is what "Save your changes" and "Changes saved" need it to ignore —
 * and what keeps "Save" away from "Delete".
 */
function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean))
  const right = new Set(b.split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared++
  }
  return (2 * shared) / (left.size + right.size)
}

/**
 * Where a fuzzy match stops being one. Fixed rather than a parameter: a caller
 * cannot calibrate a number it never sees the scores behind, and a threshold
 * that moves would make the same query answer differently between runs.
 */
const FUZZY_THRESHOLD = 0.6

/**
 * The comparison one search runs against every key path and value, built once
 * so the query is normalized once instead of per candidate.
 */
function buildMatcher(matchMode: SearchMatchMode, query: string): (candidate: string) => boolean {
  if (matchMode === 'contains') {
    const needle = query.toLowerCase()
    return candidate => candidate.toLowerCase().includes(needle)
  }

  const normalizedQuery = normalizeForMatch(query)
  if (matchMode === 'exact') {
    return candidate => normalizeForMatch(candidate) === normalizedQuery
  }

  return (candidate) => {
    if (normalizedQuery === '') return false
    const normalized = normalizeForMatch(candidate)
    // Containment first: a query that is one phrase of a longer value scores
    // low on token overlap and is still exactly what the caller meant.
    return normalized.includes(normalizedQuery)
      || tokenSimilarity(normalizedQuery, normalized) >= FUZZY_THRESHOLD
  }
}

/** One layer's file for one locale, read once and reused by both passes below. */
interface LocaleSheet {
  layer: string
  locale: string
  data: Record<string, unknown>
}

/**
 * Collapse the detail rows to one row per key.
 *
 * `layers` and `localeCount` are counted over every sheet in scope rather than
 * over the rows that matched: a key whose German value matched is still defined
 * in the other six layers, and that is the fact the caller is asking for.
 */
function groupMatchesByKey(
  matches: SearchMatch[],
  sheets: LocaleSheet[],
  referenceCode: string,
): SearchKeyMatch[] {
  const grouped: SearchKeyMatch[] = []

  for (const key of new Set(matches.map(match => match.key))) {
    const defining = sheets.filter(sheet => getNestedValue(sheet.data, key) !== undefined)
    // The reference locale is what a caller reads the value in; any locale that
    // has it beats reporting none at all when the reference locale does not.
    const source = defining.find(sheet => sheet.locale === referenceCode) ?? defining[0]
    if (!source) continue

    grouped.push({
      key,
      layers: [...new Set(defining.map(sheet => sheet.layer))],
      value: getNestedValue(source.data, key),
      locale: source.locale,
      localeCount: new Set(defining.map(sheet => sheet.locale)).size,
    })
  }

  return grouped
}

/**
 * Search translation files by key path or value.
 *
 * Returns one row per key. The detail rows — one per key and locale — are what
 * `includeLocales` asks for.
 */
export async function searchTranslations(opts: {
  query: string
  searchIn?: 'keys' | 'values' | 'both'
  matchMode?: SearchMatchMode
  includeLocales?: boolean
  layer?: string
  locale?: string
  projectDir?: string
}): Promise<SearchTranslationsResult> {
  const { query, layer, locale } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const mode = opts.searchIn ?? 'both'
  const matchMode = opts.matchMode ?? 'contains'
  const isMatch = buildMatcher(matchMode, query)

  const layersToSearch = (layer && layer !== '*')
    ? config.localeDirs.filter(d => d.layer === layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToSearch.length === 0) {
    if (layer && layer !== '*') {
      findLayerOrThrow(config, layer)
    }
    throw new ToolError('No locale directories found. Run discover to verify the project setup.', 'LAYER_NOT_FOUND')
  }

  const localesToSearch = locale
    ? (() => {
        const found = findLocaleImpl(config, locale)
        if (!found) {
          throw new ToolError(`Locale not found: "${locale}". Available: ${config.locales.map(l => l.code).join(', ')}. Use one of the available locale codes or file names.`, 'LOCALE_NOT_FOUND')
        }
        return [found]
      })()
    : config.locales

  // The locale the grouped rows quote their value in. Resolved leniently: a
  // project whose default locale is missing from its own locale list still
  // searched fine before, and grouping is not the place to start refusing it.
  const referenceLocale = findLocaleImpl(config, locale ?? config.defaultLocale) ?? localesToSearch[0]

  // A normalized comparison run against thirty locales answers with the same
  // keys and a translation in a language the caller did not ask about, so the
  // two normalized modes compare against one locale: the requested one, or the
  // project default. Substring search keeps looking everywhere, because that is
  // what it did before and what finds a value by its German wording.
  const localesToMatch = matchMode === 'contains' || locale || !referenceLocale
    ? localesToSearch
    : [referenceLocale]
  const matchedCodes = new Set(localesToMatch.map(l => l.code))

  const sheets: LocaleSheet[] = []
  for (const localeDir of layersToSearch) {
    for (const loc of localesToSearch) {
      const data = await readLocaleDataIfPresent(config, localeDir.layer, loc)
      if (!data) continue
      sheets.push({ layer: localeDir.layer, locale: loc.code, data })
    }
  }

  const matches: SearchMatch[] = []

  for (const sheet of sheets) {
    if (!matchedCodes.has(sheet.locale)) continue

    for (const key of getLeafKeys(sheet.data)) {
      const value = getNestedValue(sheet.data, key)
      const valueStr = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')

      const keyMatch = (mode === 'keys' || mode === 'both') && isMatch(key)
      const valueMatch = (mode === 'values' || mode === 'both') && isMatch(valueStr)

      if (keyMatch || valueMatch) {
        matches.push({
          layer: sheet.layer,
          locale: sheet.locale,
          key,
          value,
        })
      }
    }
  }

  if (opts.includeLocales) {
    return { matches, totalMatches: matches.length }
  }

  const grouped = groupMatchesByKey(matches, sheets, referenceLocale?.code ?? config.defaultLocale)
  return { matches: grouped, totalMatches: grouped.length }
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

  if (opts.layer && opts.layer !== '*') {
    findLayerOrThrow(config, opts.layer)
  }
  const layersToScan = (opts.layer && opts.layer !== '*')
    ? config.localeDirs.filter(d => d.layer === opts.layer)
    : config.localeDirs.filter(d => !d.aliasOf)

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
