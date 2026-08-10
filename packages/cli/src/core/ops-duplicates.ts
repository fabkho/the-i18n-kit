/**
 * Cross-layer duplicate-key detection: keys defined in both a shared layer
 * and a consuming child layer, compared in one reference locale.
 */

import { detectI18nConfig } from '../config/detector.js'
import { buildLayerGraph } from '../config/layer-graph.js'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../config/types.js'
import { writeReportFile } from '../io/json-writer.js'
import { readLocaleData } from '../io/locale-data.js'
import { getNestedValue, getLeafKeys } from '../io/key-operations.js'
import { ToolError } from '../utils/errors.js'

import { findLocaleImpl, findLocaleOrThrow } from './shared.js'
import { resolveReportFilePath } from './report.js'

export interface DuplicateKeyCollision {
  key: string
  sharedLayer: string
  childLayer: string
  sharedValue: unknown
  childValue: unknown
  divergent: boolean
}

export interface FindDuplicateKeysSummary {
  totalCollisions: number
  divergentCount: number
  pairsChecked: number
  locale: string
  message?: string
}

export interface FindDuplicateKeysResult {
  collisions: DuplicateKeyCollision[]
  guidance: string
  summary: FindDuplicateKeysSummary
}

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
 * Find keys defined in both a shared layer and a consuming child layer,
 * comparing values in a single reference locale (default: the project
 * default locale). Pure locale-file I/O — no source scanning.
 */
export async function findDuplicateKeys(opts: {
  locale?: string
  projectDir?: string
  outputFile?: string
} = {}): Promise<FindDuplicateKeysResult | { reportFile: string; summary: FindDuplicateKeysSummary }> {
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

  const summary: FindDuplicateKeysSummary = {
    totalCollisions: collisions.length,
    divergentCount: collisions.filter(c => c.divergent).length,
    pairsChecked: pairs.length,
    locale: locale.code,
    ...(pairs.length === 0 ? { message: emptyPairsMessage(config) } : {}),
  }

  const output: FindDuplicateKeysResult = {
    collisions,
    guidance: DUPLICATE_GUIDANCE,
    summary,
  }

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_duplicate_keys')
  if (reportPath) {
    await writeReportFile(reportPath, output as unknown as Record<string, unknown>, {
      tool: 'find_duplicate_keys',
      args: { locale: opts.locale },
    })
    return { reportFile: reportPath, summary }
  }

  return output
}
