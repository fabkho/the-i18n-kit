/**
 * Orphan-key operations: find/remove translation keys that are not
 * referenced in source code, plus code-usage scanning.
 */

import { isAbsolute, relative } from 'node:path'

import { detectI18nConfig } from '../config/detector.js'
import { buildLayerGraph } from '../config/layer-graph.js'
import type { I18nConfig, LocaleDefinition, LocaleDir } from '../config/types.js'
import { writeCodequalityFile, writeReportFile } from '../io/json-writer.js'
import { readLocaleData, mutateLocaleData } from '../io/locale-data.js'
import { getLeafKeys, removeNestedValue } from '../io/key-operations.js'
import { scanSourceFiles, toRelativePath, findOrphanKeysForConfig } from '../scanner/code-scanner.js'
import type { OrphanScanPlan, OrphanScanResult } from '../scanner/code-scanner.js'
import { getPatternSet } from '../scanner/patterns.js'
import { ToolError } from '../utils/errors.js'

import { findLayerOrThrow, resolveReferenceLocale } from './shared.js'
import { validateReportPath, resolveOutputFile, resolveReportFilePath } from './report.js'
import { orphanKeysToCodeQuality, referenceLocaleAnchorPaths } from './codequality.js'

const MISPLACED_USAGE_NOTE
  = 'Keys referenced only from apps that do not consume their layer. '
  + 'Either the key belongs in a broader (shared) layer, or the usage is a bug. '
  + 'These keys are not counted as orphans and are never removed.'

/** True when `child` equals `parent` or lies inside it. */
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Build the scope-aware scan plan for orphan detection from the layer graph.
 *
 * Units are the distinct app root dirs plus canonical layer root dirs (each
 * scanned exactly once — nested unit dirs are carved out of ancestor scans).
 * Layer L's scope is its own layer root dir plus the root dirs of all apps
 * in `appsUsingLayer(L)`.
 *
 * Degenerate cases (no app info, or a layer consumed by no app) fall back to
 * ALL units — the whole-project behavior of the pre-scope-aware scan. Code
 * outside every unit (e.g. scripts/ in a monorepo scanned from its root) is
 * claimed by a synthetic project-root unit that counts for every layer, so
 * scoping never produces orphans the old global scan would not have.
 */
export function buildOrphanScanPlan(config: I18nConfig, projectDir: string): OrphanScanPlan {
  const graph = buildLayerGraph(config)
  const apps = config.apps ?? []

  const nameByDir = new Map<string, string>()
  const usedNames = new Set<string>()
  const claim = (dir: string, name: string): void => {
    if (nameByDir.has(dir)) return
    let unique = name
    let n = 2
    while (usedNames.has(unique)) unique = `${name}#${n++}`
    nameByDir.set(dir, unique)
    usedNames.add(unique)
  }

  // Apps claim first so a dir shared by an app and its layer reports the app name.
  for (const app of apps) claim(app.rootDir, app.name)
  for (const layer of graph.canonicalLayers) claim(layer.layerRootDir, layer.layer)

  let projectUnitName: string | undefined
  if (![...nameByDir.keys()].some(unitDir => isWithin(projectDir, unitDir))) {
    claim(projectDir, 'project-root')
    projectUnitName = nameByDir.get(projectDir)
  }

  const units = [...nameByDir].map(([dir, name]) => ({ name, dir }))
  const allNames = units.map(u => u.name)

  const scopeByLayer = new Map<string, string[]>()
  for (const layer of graph.canonicalLayers) {
    const consumers = graph.appsUsingLayer(layer.layer)
    if (apps.length === 0 || consumers.length === 0) {
      scopeByLayer.set(layer.layer, allNames)
      continue
    }
    const scope = new Set<string>()
    if (projectUnitName) scope.add(projectUnitName)
    scope.add(nameByDir.get(layer.layerRootDir)!)
    for (const appName of consumers) {
      const app = apps.find(a => a.name === appName)
      if (app) scope.add(nameByDir.get(app.rootDir)!)
    }
    scopeByLayer.set(layer.layer, [...scope])
  }

  return { units, scopeByLayer }
}

/** Relativize each layer's scan-scope dirs against the project dir for reporting. */
function relativeScanScope(result: OrphanScanResult, projectDir: string): Record<string, string[]> {
  const scanScope: Record<string, string[]> = {}
  for (const [layerName, dirs] of Object.entries(result.scanScopeByLayer)) {
    scanScope[layerName] = dirs.map(d => toRelativePath(d, projectDir) || '.')
  }
  return scanScope
}

/**
 * Shared scan entry for findOrphanKeys/removeOrphanKeys: explicit scanDirs
 * keep the global combined-scan behavior; otherwise a scope-aware plan is
 * built from the layer graph.
 */
async function runOrphanScan(
  config: I18nConfig,
  keysByLayer: Map<string, { keys: string[]; localeDir: LocaleDir }>,
  opts: { scanDirs?: string[]; excludeDirs?: string[]; dir: string },
): Promise<OrphanScanResult> {
  return findOrphanKeysForConfig({
    keysByLayer,
    // an empty scanDirs array means "not provided" (matches excludeDirs)
    ...(opts.scanDirs?.length ? { scanDirs: opts.scanDirs } : { scanPlan: buildOrphanScanPlan(config, opts.dir) }),
    excludeDirs: opts.excludeDirs || undefined,
    resolveIgnorePatterns: layerName => resolveOrphanIgnorePatterns(config, layerName),
    patterns: getPatternSet(config.localeFileFormat),
  })
}

export function resolveOrphanIgnorePatterns(
  config: I18nConfig,
  layer: string | undefined,
): string[] | undefined {
  if (!layer || !config.projectConfig?.orphanScan) return undefined
  const layerConfig = config.projectConfig.orphanScan[layer]
  if (!layerConfig?.ignorePatterns?.length) return undefined
  return layerConfig.ignorePatterns
}

/**
 * Shared helper for findOrphanKeys and removeOrphanKeys.
 * Resolves the locale, filters layers, validates aliases, and builds the
 * keysByLayer Map. Returns the resolved context — or throws on invalid input.
 * The caller handles the empty-report case (totalKeys === 0).
 */
async function resolveOrphanScanContext(
  config: I18nConfig,
  opts: { layer?: string; locale?: string; dir: string; toolName: string },
): Promise<{
  layersToCheck: LocaleDir[]
  keysByLayer: Map<string, { keys: string[]; localeDir: LocaleDir }>
  totalKeys: number
  localeCode: string
  localeDef: LocaleDefinition
}> {
  const { localeCode, localeDef } = resolveReferenceLocale(config, opts.locale)

  const layersToCheck = opts.layer
    ? config.localeDirs.filter(d => d.layer === opts.layer)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layersToCheck.length === 0) {
    if (opts.layer) {
      findLayerOrThrow(config, opts.layer)
    }
    throw new ToolError('No locale directories found.', 'LAYER_NOT_FOUND')
  }

  if (opts.layer && layersToCheck[0]?.aliasOf) {
    throw new ToolError(
      `Layer "${opts.layer}" is an alias of "${layersToCheck[0].aliasOf}". Use the target layer instead.`,
      'LAYER_IS_ALIAS',
    )
  }

  const keysByLayer = new Map<string, { keys: string[]; localeDir: LocaleDir }>()
  for (const ld of layersToCheck) {
    let data: Record<string, unknown>
    try {
      data = await readLocaleData(config, ld.layer, localeDef)
    } catch {
      continue
    }
    if (Object.keys(data).length === 0) continue
    keysByLayer.set(ld.layer, { keys: getLeafKeys(data), localeDir: ld })
  }

  const totalKeys = [...keysByLayer.values()].reduce((sum, v) => sum + v.keys.length, 0)

  return { layersToCheck, keysByLayer, totalKeys, localeCode, localeDef }
}

/**
 * Find translation keys that exist in locale files but are not referenced in source code.
 */
export async function findOrphanKeys(opts: {
  layer?: string
  locale?: string
  /**
   * Explicit scan roots — manual scope control. When set, all layers are
   * checked against one combined usage set from these dirs (no per-layer
   * scoping, no misplaced-usage detection). When absent, a scope-aware plan
   * from the layer graph is used: each layer is checked against the apps
   * that consume it.
   */
  scanDirs?: string[]
  excludeDirs?: string[]
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const { layersToCheck, keysByLayer, totalKeys, localeCode } = await resolveOrphanScanContext(config, {
    layer,
    locale,
    dir,
    toolName: 'find_orphan_keys',
  })

  if (totalKeys === 0) {
    const emptyOutput = { orphanKeys: {} as Record<string, string[]>, summary: { totalKeys: 0, orphanCount: 0, filesScanned: 0, message: 'No translation keys found in locale files.' } }
    const reportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
    if (reportPath) {
      await writeReportFile(reportPath, emptyOutput, {
        tool: 'find_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs },
      })
      return { reportFile: reportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await runOrphanScan(config, keysByLayer, { scanDirs, excludeDirs, dir })

  const byLayer = orphanResult.orphansByLayer
  const allOrphanKeys: Array<{ key: string; layer: string }> = []
  for (const [layerName, keys] of Object.entries(byLayer)) {
    for (const key of keys) allOrphanKeys.push({ key, layer: layerName })
  }
  allOrphanKeys.sort((a, b) => a.layer.localeCompare(b.layer) || a.key.localeCompare(b.key))
  const sortedByLayer: Record<string, string[]> = {}
  for (const { key, layer: keyLayer } of allOrphanKeys) {
    if (!sortedByLayer[keyLayer]) sortedByLayer[keyLayer] = []
    sortedByLayer[keyLayer].push(key)
  }

  const misplacedCount = orphanResult.misplacedUsages.length
  const output: Record<string, unknown> = {
    orphanKeys: sortedByLayer,
    uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
    misplacedUsages: misplacedCount > 0 ? orphanResult.misplacedUsages : undefined,
    misplacedUsageNote: misplacedCount > 0 ? MISPLACED_USAGE_NOTE : undefined,
    summary: {
      totalKeys,
      orphanCount: orphanResult.orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      misplacedCount,
      dynamicMatchedCount: orphanResult.dynamicMatchedCount,
      ignoredCount: orphanResult.ignoredCount,
      usedCount: totalKeys - orphanResult.orphanCount - orphanResult.uncertainCount - misplacedCount,
      filesScanned: orphanResult.totalFilesScanned,
      layersChecked: layersToCheck.map(d => d.layer),
      dirsScanned: orphanResult.dirsScanned,
      scanScope: relativeScanScope(orphanResult, dir),
      locale: localeCode,
    },
    dynamicKeyWarning: orphanResult.allDynamicKeys.length > 0
      ? `${orphanResult.allDynamicKeys.length} dynamic key reference(s) found (template literals with interpolation). Some "orphan" keys may actually be used via dynamic keys. Review before removing. Note: string concatenation patterns (e.g. 'prefix.' + var) are not detected — use template literals for full coverage.`
      : undefined,
    dynamicKeys: orphanResult.allDynamicKeys.length > 0
      ? orphanResult.allDynamicKeys.map(dk => ({
          expression: dk.expression,
          file: toRelativePath(dk.file, dir),
          line: dk.line,
        }))
      : undefined,
    unresolvedKeyWarnings: orphanResult.unresolvedKeyWarnings.length > 0
      ? orphanResult.unresolvedKeyWarnings.map(w => ({
          expression: w.expression,
          file: toRelativePath(w.file, dir),
          line: w.line,
          callee: w.callee,
          suggestedIgnorePattern: w.suggestedIgnorePattern,
        }))
      : undefined,
  }

  const reportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'find_orphan_keys',
      args: { layer, locale, scanDirs, excludeDirs },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Scan Vue/TS source files to find where translation keys are referenced.
 */
export async function scanCodeUsage(opts: {
  keys?: string[]
  scanDirs?: string[]
  excludeDirs?: string[]
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { keys, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)

  const dirsToScan = scanDirs ?? config.layerRootDirs

  const allUsages: Array<{ key: string; file: string; line: number; callee: string }> = []
  const allDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }> = []
  let totalFilesScanned = 0

  for (const scanDir of dirsToScan) {
    const result = await scanSourceFiles(scanDir, excludeDirs, getPatternSet(config.localeFileFormat))
    totalFilesScanned += result.filesScanned
    allUsages.push(...result.usages)
    allDynamicKeys.push(...result.dynamicKeys)
  }

  const filteredUsages = keys
    ? allUsages.filter(u => keys.includes(u.key))
    : allUsages

  const byKey: Record<string, Array<{ file: string; line: number; callee: string }>> = {}
  for (const usage of filteredUsages) {
    (byKey[usage.key] ??= []).push({
      file: toRelativePath(usage.file, dir),
      line: usage.line,
      callee: usage.callee,
    })
  }

  const sortedByKey: Record<string, Array<{ file: string; line: number; callee: string }>> = {}
  for (const [key, locations] of Object.entries(byKey).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    sortedByKey[key] = locations
  }

  const notFound = keys
    ? keys.filter(k => !byKey[k])
    : []

  const output: Record<string, unknown> = {
    usages: sortedByKey,
    summary: {
      uniqueKeysFound: Object.keys(sortedByKey).length,
      totalReferences: filteredUsages.length,
      filesScanned: totalFilesScanned,
      dirsScanned: dirsToScan,
    },
  }

  if (notFound.length > 0) {
    output.notFoundInCode = notFound
  }

  if (allDynamicKeys.length > 0) {
    output.dynamicKeys = allDynamicKeys.map(dk => ({
      expression: dk.expression,
      file: toRelativePath(dk.file, dir),
      line: dk.line,
    }))
  }

  const reportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'scan_code_usage')
  if (reportPath) {
    await writeReportFile(reportPath, output, {
      tool: 'scan_code_usage',
      args: { keys, scanDirs, excludeDirs },
    })
    return { reportFile: reportPath, summary: output.summary }
  }

  return output
}

/**
 * Find translation keys not referenced in source code and remove them.
 */
export async function removeOrphanKeys(opts: {
  layer?: string
  locale?: string
  /** Explicit scan roots — manual scope control, same semantics as {@link findOrphanKeys}. */
  scanDirs?: string[]
  excludeDirs?: string[]
  dryRun?: boolean
  projectDir?: string
  outputFile?: string
  /** Also write the orphan findings as a GitLab Code Quality JSON array to this path. */
  codequalityOutput?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? true

  const { keysByLayer, totalKeys, localeDef } = await resolveOrphanScanContext(config, {
    layer,
    locale,
    dir,
    toolName: 'remove_orphan_keys',
  })

  // Written in every branch, even without findings: an empty array on the
  // default branch is the baseline the MR widget diffs against.
  const writeCodequality = async (orphans: Record<string, string[]>): Promise<void> => {
    if (!opts.codequalityOutput) return
    validateReportPath(dir, opts.codequalityOutput)
    const anchors = referenceLocaleAnchorPaths(config, Object.keys(orphans), localeDef, dir)
    await writeCodequalityFile(opts.codequalityOutput, orphanKeysToCodeQuality(orphans, anchors))
  }

  if (totalKeys === 0) {
    await writeCodequality({})
    const emptyOutput = { orphanKeys: {}, removed: {}, summary: { totalKeys: 0, orphanCount: 0, message: 'No translation keys found.' } }
    const emptyReportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (emptyReportPath) {
      await writeReportFile(emptyReportPath, emptyOutput, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: emptyReportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await runOrphanScan(config, keysByLayer, { scanDirs, excludeDirs, dir })
  await writeCodequality(orphanResult.orphansByLayer)
  const orphansByLayer = orphanResult.orphansByLayer
  const orphanCount = orphanResult.orphanCount
  const totalFilesScanned = orphanResult.totalFilesScanned
  const dynamicMatchedCount = orphanResult.dynamicMatchedCount
  const ignoredCount = orphanResult.ignoredCount
  const misplacedCount = orphanResult.misplacedUsages.length
  const misplacedUsages = misplacedCount > 0 ? orphanResult.misplacedUsages : undefined
  const misplacedUsageNote = misplacedCount > 0 ? MISPLACED_USAGE_NOTE : undefined
  const scanScope = relativeScanScope(orphanResult, dir)
  const allDynamicKeys = orphanResult.allDynamicKeys.map(dk => ({
    expression: dk.expression,
    file: toRelativePath(dk.file, dir),
    line: dk.line,
  }))

  if (orphanCount === 0) {
    const messageParts: string[] = ['No orphan keys found.']
    if (dynamicMatchedCount > 0) messageParts.push(`${dynamicMatchedCount} key(s) were excluded by dynamic pattern matching.`)
    if (ignoredCount > 0) messageParts.push(`${ignoredCount} key(s) were excluded by ignore patterns.`)
    if (orphanResult.uncertainCount > 0) messageParts.push(`${orphanResult.uncertainCount} uncertain key(s) were excluded because they overlap with dynamic translation patterns.`)
    if (misplacedCount > 0) messageParts.push(`${misplacedCount} key(s) are referenced only outside their layer's scope (see misplacedUsages).`)
    if (dynamicMatchedCount === 0 && ignoredCount === 0 && orphanResult.uncertainCount === 0 && misplacedCount === 0) messageParts.push('All translation keys are referenced in code.')
    const zeroOutput: Record<string, unknown> = {
      orphanKeys: {},
      uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
      misplacedUsages,
      misplacedUsageNote,
      summary: { totalKeys, orphanCount: 0, uncertainCount: orphanResult.uncertainCount, misplacedCount, dynamicMatchedCount, ignoredCount, filesScanned: totalFilesScanned, scanScope, message: messageParts.join(' ') },
    }
    const zeroReportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (zeroReportPath) {
      await writeReportFile(zeroReportPath, zeroOutput, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: zeroReportPath, summary: zeroOutput.summary }
    }
    return zeroOutput
  }

  // Dry run — just report
  if (isDryRun) {
    const output: Record<string, unknown> = {
      orphanKeys: orphansByLayer,
      uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
      misplacedUsages,
      misplacedUsageNote,
      summary: {
        dryRun: true,
        totalKeys,
        orphanCount,
        uncertainCount: orphanResult.uncertainCount,
        misplacedCount,
        dynamicMatchedCount,
        ignoredCount,
        usedCount: totalKeys - orphanCount - orphanResult.uncertainCount - misplacedCount,
        filesScanned: totalFilesScanned,
        scanScope,
        message: `Found ${orphanCount} orphan key(s) safe to remove.${orphanResult.uncertainCount > 0 ? ` ${orphanResult.uncertainCount} uncertain key(s) excluded (overlap with dynamic translation patterns).` : ''}${misplacedCount > 0 ? ` ${misplacedCount} key(s) referenced only outside their layer's scope were excluded (see misplacedUsages).` : ''} ${dynamicMatchedCount > 0 ? `${dynamicMatchedCount} key(s) matched dynamic patterns and were excluded. ` : ''}${ignoredCount > 0 ? `${ignoredCount} key(s) matched ignore patterns and were excluded. ` : ''}Call again with dryRun: false to remove them.`,
      },
    }
    if (allDynamicKeys.length > 0) {
      output.dynamicKeyWarning = `${allDynamicKeys.length} dynamic key reference(s) found. Some "orphan" keys may be used via dynamic keys. Review before removing. Note: string concatenation patterns (e.g. 'prefix.' + var) are not detected — use template literals for full coverage.`
      output.dynamicKeys = allDynamicKeys
    }
    if (orphanResult.unresolvedKeyWarnings.length > 0) {
      output.unresolvedKeyWarnings = orphanResult.unresolvedKeyWarnings.map(w => ({
        expression: w.expression,
        file: toRelativePath(w.file, dir),
        line: w.line,
        callee: w.callee,
        suggestedIgnorePattern: w.suggestedIgnorePattern,
      }))
    }
    const dryRunReportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (dryRunReportPath) {
      await writeReportFile(dryRunReportPath, output, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: dryRunReportPath, summary: output.summary }
    }
    return output
  }

  // Actual removal
  const removedByLayer: Record<string, string[]> = {}
  let totalFilesWritten = 0

  for (const [layerName, orphans] of Object.entries(orphansByLayer)) {
    const ld = config.localeDirs.find(d => d.layer === layerName)!
    if (ld.aliasOf) continue

    for (const localeDef2 of config.locales) {
      try {
        const written = await mutateLocaleData(config, layerName, localeDef2, (fileData) => {
          for (const key of orphans) {
            removeNestedValue(fileData, key)
          }
        })
        totalFilesWritten += written.size
      } catch {
        continue
      }
    }

    removedByLayer[layerName] = orphans
  }

  const removalOutput: Record<string, unknown> = {
    removed: removedByLayer,
    uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
    misplacedUsages,
    misplacedUsageNote,
    summary: {
      dryRun: false,
      totalKeys,
      removedCount: orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      misplacedCount,
      dynamicMatchedCount,
      ignoredCount,
      remainingCount: totalKeys - orphanCount,
      filesWritten: totalFilesWritten,
      filesScanned: totalFilesScanned,
      scanScope,
    },
  }

  const removalReportPath = resolveOutputFile(dir, opts.outputFile) ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
  if (removalReportPath) {
    await writeReportFile(removalReportPath, removalOutput, {
      tool: 'remove_orphan_keys',
      args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
    })
    return { reportFile: removalReportPath, summary: removalOutput.summary }
  }

  return removalOutput
}
