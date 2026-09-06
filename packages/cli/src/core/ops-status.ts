/**
 * status: translation coverage per locale and per layer, in one call.
 */

import { detectI18nConfig } from '../config/detector.js'
import { buildLayerGraph } from '../config/layer-graph.js'
import { readLocaleData, readLocaleDataIfPresent } from '../io/locale-data.js'
import { getNestedValue, getLeafKeys } from '../io/key-operations.js'
import { writeReportFile } from '../io/json-writer.js'
import { findReferenceLocaleOrThrow, localeRefInfo, resolveLayersToScan } from './shared.js'
import { resolveProtectedLocales } from './ops-translate.js'
import { resolveOutputFile, resolveReportFilePath } from './report.js'
import type { LocaleDefinition, LocaleDir, I18nConfig } from '../config/types.js'
import type { TranslationStatusResult, LocaleStatus, LayerStatus } from './types.js'

/**
 * Keys worth translating: present in the reference locale with a non-empty
 * value. An empty reference value is nothing to translate *from*, so counting
 * it would deflate every locale equally and hide real gaps.
 */
function referenceKeys(refData: Record<string, unknown>): string[] {
  return getLeafKeys(refData).filter((k) => {
    const v = getNestedValue(refData, k)
    return typeof v === 'string' ? v.length > 0 : v !== null && v !== undefined
  })
}

type KeyState = 'translated' | 'missing' | 'empty'

/**
 * Classify one key in one locale. `missing` and `empty` are both untranslated
 * but distinct: a missing key was never written, an empty one was scaffolded
 * and never filled. Reporting them separately is what tells a scaffold-and-
 * forget locale apart from an untouched one — matching how
 * getMissingTranslations already treats empties as not-translated.
 */
function classify(data: Record<string, unknown>, key: string): KeyState {
  const value = getNestedValue(data, key)
  if (value === undefined || value === null) return 'missing'
  if (typeof value === 'string' && value.length === 0) return 'empty'
  return 'translated'
}

function percent(translated: number, total: number): number {
  if (total === 0) return 100
  return Math.round((translated / total) * 1000) / 10
}

interface Counts { total: number, translated: number, missing: number, empty: number }

const emptyCounts = (): Counts => ({ total: 0, translated: 0, missing: 0, empty: 0 })

/** Counts for one locale against one layer's reference keys. */
function countLocale(data: Record<string, unknown>, keys: string[]): Counts {
  const counts = emptyCounts()
  for (const key of keys) {
    counts.total += 1
    counts[classify(data, key)] += 1
  }
  return counts
}

function merge(into: Counts | undefined, from: Counts): void {
  if (!into) return
  into.total += from.total
  into.translated += from.translated
  into.missing += from.missing
  into.empty += from.empty
}

/**
 * Coverage for a project: per locale, per layer, and one overall figure.
 *
 * Protected locales are counted and reported but excluded from the overall
 * percentage — they are maintained by hand, so counting their gaps as project
 * debt makes a healthy project read as failing and moves a number nobody can
 * act on.
 */
export async function getTranslationStatus(opts: {
  layer?: string
  referenceLocale?: string
  projectDir?: string
  outputFile?: string
}): Promise<TranslationStatusResult> {
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const refLocale = findReferenceLocaleOrThrow(config, opts.referenceLocale)

  const layersToScan = resolveLayersToScan(config, opts.layer)

  const protectedCodes = new Set(resolveProtectedLocales(config).map(l => l.code))
  const targets = config.locales.filter(l => l.code !== refLocale.code)

  const byLocale = new Map<string, Counts>(targets.map(l => [l.code, emptyCounts()]))
  const byLayer = new Map<string, Counts>(layersToScan.map(d => [d.layer, emptyCounts()]))

  await tally({ config, layersToScan, refLocale, targets, protectedCodes, byLocale, byLayer })

  const locales: LocaleStatus[] = targets.map((locale) => {
    const c = byLocale.get(locale.code) ?? emptyCounts()
    const isProtected = protectedCodes.has(locale.code)
    return {
      ...localeRefInfo(locale),
      ...c,
      completion: percent(c.translated, c.total),
      ...(isProtected ? { protected: true, excludedFromOverall: true } : {}),
    }
  })

  // The layer graph already knows which apps declare which layers; a layer no
  // app consumes holds keys nothing can render, which no other tool reports.
  const graph = buildLayerGraph(config)

  const layers: LayerStatus[] = [...byLayer.entries()].map(([layer, c]) => ({
    layer,
    ...c,
    completion: percent(c.translated, c.total),
    consumedBy: graph.appsUsingLayer(layer),
  }))

  // With one app (what every single-locale-dir adapter builds) every layer is
  // either that app's or nobody's, and "nobody's" is then an artefact of the
  // config rather than a monorepo smell. Only flag it where apps compete.
  const unconsumedLayers = (config.apps ?? []).length > 1
    ? layers.filter(l => l.consumedBy.length === 0).map(l => l.layer)
    : []

  const counted = locales.filter(l => !l.protected)
  const overallTranslated = counted.reduce((n, l) => n + l.translated, 0)
  const overallTotal = counted.reduce((n, l) => n + l.total, 0)

  const output: TranslationStatusResult = {
    locales,
    layers,
    summary: {
      referenceLocale: localeRefInfo(refLocale),
      layersScanned: layersToScan.map(d => d.layer),
      unconsumedLayers,
      localesChecked: counted.length,
      protectedLocales: locales.filter(l => l.protected).map(l => l.code),
      totalKeys: overallTotal,
      translatedKeys: overallTranslated,
      missingKeys: counted.reduce((n, l) => n + l.missing, 0),
      emptyKeys: counted.reduce((n, l) => n + l.empty, 0),
      // The gate in #248 reads this counter, so the name is load-bearing.
      completionPercent: percent(overallTranslated, overallTotal),
    },
  }

  const reportPath = resolveOutputFile(dir, opts.outputFile)
    ?? resolveReportFilePath(config, dir, 'get_translation_status')
  if (reportPath) {
    await writeReportFile(reportPath, output as unknown as Record<string, unknown>, {
      tool: 'get_translation_status',
      args: { layer: opts.layer, referenceLocale: opts.referenceLocale },
    })
    // Summary only: the per-locale and per-layer arrays grow with the project,
    // and a health check must never flood a caller's context.
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

async function readTargetData(
  config: I18nConfig,
  layer: string,
  target: LocaleDefinition,
): Promise<Record<string, unknown>> {
  try {
    return await readLocaleData(config, layer, target)
  }
  catch {
    // A locale with no file in this layer is entirely missing, not an error.
    return {}
  }
}

/** Walk every layer once, accumulating both breakdowns in a single pass. */
async function tally(ctx: {
  config: I18nConfig
  layersToScan: LocaleDir[]
  refLocale: LocaleDefinition
  targets: LocaleDefinition[]
  protectedCodes: Set<string>
  byLocale: Map<string, Counts>
  byLayer: Map<string, Counts>
}): Promise<void> {
  for (const localeDir of ctx.layersToScan) {
    const refData = await readLocaleDataIfPresent(ctx.config, localeDir.layer, ctx.refLocale)
    if (!refData) continue

    const keys = referenceKeys(refData)
    if (keys.length === 0) continue

    for (const target of ctx.targets) {
      const counts = countLocale(await readTargetData(ctx.config, localeDir.layer, target), keys)
      merge(ctx.byLocale.get(target.code), counts)
      // A protected locale's gaps are deliberate, so they must not drag the
      // layer figure down either — the layer is not what is incomplete.
      if (!ctx.protectedCodes.has(target.code)) merge(ctx.byLayer.get(localeDir.layer), counts)
    }
  }
}
