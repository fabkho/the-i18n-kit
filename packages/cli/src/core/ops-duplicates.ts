/**
 * Cross-layer duplicate-key detection: keys defined in both a shared layer
 * and a consuming child layer, compared in one reference locale.
 */

import { detectI18nConfig } from '../config/detector.js'
import { buildLayerGraph } from '../config/layer-graph.js'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../config/types.js'
import { readLocaleData } from '../io/locale-data.js'
import { getNestedValue, getLeafKeys } from '../io/key-operations.js'
import { buildIgnorePatternRegexes } from '../scanner/code-scanner.js'
import { ToolError } from '../utils/errors.js'

import { findLocaleImpl, findLocaleOrThrow } from './shared.js'
import { resolveOrphanIgnorePatterns } from './ops-orphans.js'

export interface DuplicateKeyCollision {
  key: string
  sharedLayer: string
  childLayer: string
  sharedValue: unknown
  childValue: unknown
  divergent: boolean
}

/** One key carrying a duplicated value, with the layer it lives in. */
export interface ValueDuplicateMember {
  key: string
  layer: string
  /**
   * True when this layer is one another layer falls through to at runtime, so
   * a key here is already reachable from the layers above it.
   */
  shared: boolean
}

/**
 * What to do about a group, and therefore how it sorts. `reuse` first: the
 * shared key already exists, so the fix costs nothing but deletions.
 */
export type ValueDuplicateAction = 'reuse' | 'promote' | 'consolidate'

export interface ValueDuplicateGroup {
  /** The value as written, from the first member. */
  value: string
  /** What the members were grouped by — trimmed, case-folded, punctuation-stripped. */
  normalized: string
  action: ValueDuplicateAction
  members: ValueDuplicateMember[]
}

export interface FindDuplicateKeysSummary {
  totalCollisions: number
  divergentCount: number
  pairsChecked: number
  locale: string
  /** Present when value duplicates were requested. */
  valueGroups?: number
  reusableGroups?: number
  message?: string
}

export interface FindDuplicateKeysResult {
  collisions: DuplicateKeyCollision[]
  /** Present when value duplicates were requested. */
  valueDuplicates?: ValueDuplicateGroup[]
  guidance: string
  summary: FindDuplicateKeysSummary
}

/**
 * Values shorter than this are excluded from value grouping. "Ja", "OK" and
 * "Nein" repeat across unrelated namespaces legitimately, and reporting them
 * buries the findings worth acting on. A length floor is a blunt rule, which
 * is the point — anything cleverer would be guessing at intent.
 */
const DEFAULT_MIN_VALUE_LENGTH = 4

/**
 * A floor arrives as a CLI string or an MCP number, so it can be NaN or
 * negative by the time it lands here. Comparing a length against NaN is always
 * false, which silently removes the floor and buries the report in "OK" — the
 * opposite of what asking for a floor means. Saying so beats defaulting: the
 * caller asked for a specific threshold and would not learn it was ignored.
 */
function resolveMinValueLength(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_MIN_VALUE_LENGTH
  if (!Number.isFinite(requested) || requested < 0) {
    throw new ToolError(
      // String(), not JSON.stringify(): the latter renders NaN as "null", which
      // is the one value this message most needs to name.
      `minValueLength must be a non-negative number, got ${String(requested)}.`,
      'INVALID_MIN_VALUE_LENGTH',
    )
  }
  return Math.floor(requested)
}

const VALUE_DUPLICATE_GUIDANCE
  = 'Different keys carrying the same value. "reuse" means a shared layer already defines this '
  + 'value: delete the app-layer keys and repoint their call sites at the shared key. "promote" '
  + 'means two or more app layers define it and no shared layer does: move one to a shared layer '
  + '(move_translation_key) and repoint the rest. "consolidate" is duplication inside one layer. '
  + 'Each duplicate is translated into every locale separately, so removing one saves provider '
  + 'spend on every future translate run, not just tidiness. Short generic labels ("Name", '
  + '"Status") dominate the list by group size and are the least worth acting on individually; '
  + 'raise minValueLength to see the longer copy, where duplication is rarely deliberate.'

const DUPLICATE_GUIDANCE
  = 'At runtime the child layer\'s value shadows the shared layer\'s value for the same key. '
  + 'Fix each collision by deleting one side — usually the shared copy when the child value is '
  + 'authoritative, or the child copy to fall through to the shared value. Never move the key: '
  + 'both layers already define it.'

/** Leaf values may be arrays (getLeafKeys treats them as leaves) — compare
 *  those structurally; identity covers primitives. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

interface LayerPair {
  shared: LocaleDir
  child: LocaleDir
}

/**
 * Derive the (shared layer, child layer) pairs to check from each app's
 * configured layer order: earlier entries override later ones at runtime,
 * so for any two locale-backed layers an app consumes, the earlier one is
 * the child (its values shadow) and the later one is the shared base.
 * Pairs are deduped unordered; if two apps ever disagree on precedence
 * (pathological), the first-seen direction wins. With no app info there
 * are no pairs.
 */
/** An app's locale-backed canonical layers in its configured precedence order. */
function orderedCanonicalLayers(
  layerNames: string[],
  graph: ReturnType<typeof buildLayerGraph>,
  canonicalByName: Map<string, LocaleDir>,
): LocaleDir[] {
  const ordered: LocaleDir[] = []
  const seen = new Set<string>()
  for (const name of layerNames) {
    const canonical = canonicalByName.get(graph.ownerOf(name))
    if (canonical && !seen.has(canonical.layer)) {
      seen.add(canonical.layer)
      ordered.push(canonical)
    }
  }
  return ordered
}

function deriveLayerPairs(config: I18nConfig, graph: ReturnType<typeof buildLayerGraph>): LayerPair[] {
  const canonicalByName = new Map(graph.canonicalLayers.map(d => [d.layer, d]))
  const pairs: LayerPair[] = []
  const seen = new Set<string>()

  for (const app of config.apps ?? []) {
    const ordered = orderedCanonicalLayers(app.layers, graph, canonicalByName)
    for (const [i, child] of ordered.entries()) {
      for (const shared of ordered.slice(i + 1)) {
        const id = [child.layer, shared.layer].sort().join('\u0000')
        if (seen.has(id)) continue
        seen.add(id)
        pairs.push({ shared, child })
      }
    }
  }

  return pairs
}

function emptyPairsMessage(config: I18nConfig): string {
  if ((config.apps ?? []).length === 0) {
    return 'No app info in the config, so layer consumption edges are unknowable and no '
      + '(shared layer, child layer) pairs can be derived. Duplicate detection needs '
      + 'app-to-layer consumption info (e.g. a multi-app Nuxt monorepo config).'
  }
  return 'No (shared layer, child layer) pairs to check — no app consumes more than one locale-backed layer.'
}

/**
 * Group keys by the value they carry, so that two keys spelling the same
 * string differently are visible as the duplication they are.
 *
 * Key-path collision detection cannot see this: `common.actions.save` and
 * `calendar.views.save` collide on nothing while both holding "Speichern"
 * (#343). Each duplicate is then translated into every locale independently,
 * so the duplication costs provider spend on every run, not just tidiness.
 */
function groupByValue(
  entries: Array<{ key: string, layer: string, value: unknown }>,
  sharedLayers: Set<string>,
  minValueLength: number,
): ValueDuplicateGroup[] {
  const byNormalized = new Map<string, ValueDuplicateGroup>()

  for (const entry of entries) {
    if (typeof entry.value !== 'string') continue
    const normalized = normalizeValue(entry.value)
    if (normalized.length < minValueLength) continue

    const group = byNormalized.get(normalized) ?? {
      value: entry.value,
      normalized,
      action: 'consolidate' as ValueDuplicateAction,
      members: [],
    }
    group.members.push({ key: entry.key, layer: entry.layer, shared: sharedLayers.has(entry.layer) })
    byNormalized.set(normalized, group)
  }

  const groups = [...byNormalized.values()].filter(group =>
    group.members.length > 1
    // One key path defined in several layers is a collision, which the
    // pair-wise check above already reports with both values. Repeating it
    // here as a value duplicate says nothing new.
    && new Set(group.members.map(m => m.key)).size > 1,
  )
  for (const group of groups) group.action = classifyGroup(group.members)

  // Actionability first, then size: the biggest reuse opportunity is the one
  // worth reading, and a long list of same-layer consolidations is not.
  const rank: Record<ValueDuplicateAction, number> = { reuse: 0, promote: 1, consolidate: 2 }
  return groups.sort((a, b) =>
    rank[a.action] - rank[b.action]
    || b.members.length - a.members.length
    || a.normalized.localeCompare(b.normalized),
  )
}

function classifyGroup(members: ValueDuplicateMember[]): ValueDuplicateAction {
  const inShared = members.filter(m => m.shared)
  // A shared layer already carries the value, so nothing needs moving.
  if (inShared.length > 0 && inShared.length < members.length) return 'reuse'
  if (new Set(members.map(m => m.layer)).size > 1) return 'promote'
  return 'consolidate'
}

/**
 * Fold away the differences that do not change what a translator would write:
 * surrounding space, capitalisation, internal whitespace runs and trailing
 * punctuation. "Speichern", "speichern " and "Speichern." group together.
 */
function normalizeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;,\u2026]+$/u, '')
    // toLowerCase, not toLocaleLowerCase: the latter folds by the host's
    // locale, so the same repository would group differently on a Turkish
    // machine. A grouping key has to be a property of the data.
    .toLowerCase()
}

/** Every leaf key of every canonical layer, minus the ones config says to ignore. */
async function collectLayerEntries(
  config: I18nConfig,
  layers: LocaleDir[],
  dataFor: (layer: string) => Promise<Record<string, unknown>>,
): Promise<Array<{ key: string, layer: string, value: unknown }>> {
  const entries: Array<{ key: string, layer: string, value: unknown }> = []

  for (const layer of layers) {
    const data = await dataFor(layer.layer)
    // The same patterns the orphan scan honours: a key deliberately excluded
    // there is not one a duplicate report should raise either.
    const ignore = buildIgnorePatternRegexes(resolveOrphanIgnorePatterns(config, layer.layer) ?? [])
    for (const key of getLeafKeys(data)) {
      if (ignore.some(re => re.test(key))) continue
      entries.push({ key, layer: layer.layer, value: getNestedValue(data, key) })
    }
  }

  return entries
}

/** Keys defined on both sides of each (shared, child) pair, in one locale. */
async function findCollisions(
  pairs: LayerPair[],
  dataFor: (layer: string) => Promise<Record<string, unknown>>,
): Promise<DuplicateKeyCollision[]> {
  const collisions: DuplicateKeyCollision[] = []

  for (const { shared, child } of pairs) {
    const sharedData = await dataFor(shared.layer)
    const childData = await dataFor(child.layer)
    const childKeys = new Set(getLeafKeys(childData))

    for (const key of getLeafKeys(sharedData)) {
      if (!childKeys.has(key)) continue
      const sharedValue = getNestedValue(sharedData, key)
      const childValue = getNestedValue(childData, key)
      collisions.push({
        key,
        sharedLayer: shared.layer,
        childLayer: child.layer,
        sharedValue,
        childValue,
        divergent: !valuesEqual(sharedValue, childValue),
      })
    }
  }

  return collisions
}

/**
 * Find keys defined in both a shared layer and a consuming child layer,
 * comparing values in a single reference locale (default: the project
 * default locale). Pure locale-file I/O — no source scanning.
 */
export async function findDuplicateKeys(opts: {
  locale?: string
  projectDir?: string
  /**
   * Also group keys by the value they carry. Off by default: it reads every
   * canonical layer rather than only the paired ones, and the existing result
   * shape stays exactly as it was for callers that do not ask.
   */
  byValue?: boolean
  /** Shortest value worth grouping. Below it, repetition is usually legitimate. */
  minValueLength?: number
} = {}): Promise<FindDuplicateKeysResult> {
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const locale: LocaleDefinition | undefined = opts.locale
    ? findLocaleOrThrow(config, opts.locale)
    : findLocaleImpl(config, config.defaultLocale) ?? config.locales[0]
  if (!locale) {
    throw new ToolError('No locales found in configuration.', 'LOCALE_NOT_FOUND')
  }

  const graph = buildLayerGraph(config)
  const pairs = deriveLayerPairs(config, graph)

  // Each layer's data is read once even when it appears in several pairs.
  const layerDataCache = new Map<string, Promise<Record<string, unknown>>>()
  const dataFor = (layer: string): Promise<Record<string, unknown>> => {
    let cached = layerDataCache.get(layer)
    if (!cached) {
      // readLocaleData already yields {} for missing files; real failures
      // (parse errors, permissions) must surface, not read as "no keys".
      cached = readLocaleData(config, layer, locale)
      layerDataCache.set(layer, cached)
    }
    return cached
  }

  const collisions = await findCollisions(pairs, dataFor)

  const valueDuplicates = opts.byValue
    ? groupByValue(
        await collectLayerEntries(config, graph.canonicalLayers, dataFor),
        // The layers something falls through to, from the same pairs the
        // collision check uses — not graph.sharedLayers, which means "consumed
        // by more than one app". A single-app project has no layer shared in
        // that sense, yet its root layer is still the one whose keys the app
        // can reuse, which is the question this report answers.
        new Set(pairs.map(pair => pair.shared.layer)),
        resolveMinValueLength(opts.minValueLength),
      )
    : undefined

  const summary: FindDuplicateKeysSummary = {
    totalCollisions: collisions.length,
    divergentCount: collisions.filter(c => c.divergent).length,
    pairsChecked: pairs.length,
    locale: locale.code,
    ...(valueDuplicates
      ? {
          valueGroups: valueDuplicates.length,
          reusableGroups: valueDuplicates.filter(g => g.action === 'reuse').length,
        }
      : {}),
    ...(pairs.length === 0 ? { message: emptyPairsMessage(config) } : {}),
  }

  return {
    collisions,
    ...(valueDuplicates ? { valueDuplicates } : {}),
    guidance: valueDuplicates ? `${DUPLICATE_GUIDANCE}\n\n${VALUE_DUPLICATE_GUIDANCE}` : DUPLICATE_GUIDANCE,
    summary,
  }
}
