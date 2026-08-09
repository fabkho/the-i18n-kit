/**
 * Orphan-key operations: find/remove translation keys that are not
 * referenced in source code, plus code-usage scanning.
 */

import { detectI18nConfig } from '../config/detector.js'
import type { I18nConfig, LocaleDir } from '../config/types.js'
import { writeReportFile } from '../io/json-writer.js'
import { readLocaleData, mutateLocaleData } from '../io/locale-data.js'
import { getLeafKeys, removeNestedValue } from '../io/key-operations.js'
import { scanSourceFiles, toRelativePath, findOrphanKeysForConfig } from '../scanner/code-scanner.js'
import { getPatternSet } from '../scanner/patterns.js'
import { ToolError } from '../utils/errors.js'

import { findLayerOrThrow, findLocaleImpl } from './shared.js'
import { validateReportPath, resolveReportFilePath } from './report.js'

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
}> {
  const localeCode = opts.locale ?? config.defaultLocale
  const localeDef = findLocaleImpl(config, localeCode)
  if (!localeDef) {
    throw new ToolError(
      `Locale not found: "${localeCode}". Available: ${config.locales.map(l => l.code).join(', ')}`,
      'LOCALE_NOT_FOUND',
    )
  }

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

  return { layersToCheck, keysByLayer, totalKeys, localeCode }
}

/**
 * Find translation keys that exist in locale files but are not referenced in source code.
 */
export async function findOrphanKeys(opts: {
  layer?: string
  locale?: string
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
    const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
    if (reportPath) {
      await writeReportFile(reportPath, emptyOutput, {
        tool: 'find_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs },
      })
      return { reportFile: reportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await findOrphanKeysForConfig({
    keysByLayer,
    scanDirs: scanDirs || [dir],
    excludeDirs: excludeDirs || undefined,
    resolveIgnorePatterns: (layerName) => resolveOrphanIgnorePatterns(config, layerName),
    patterns: getPatternSet(config.localeFileFormat),
  })

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

  const output: Record<string, unknown> = {
    orphanKeys: sortedByLayer,
    uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
    summary: {
      totalKeys,
      orphanCount: orphanResult.orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      dynamicMatchedCount: orphanResult.dynamicMatchedCount,
      ignoredCount: orphanResult.ignoredCount,
      usedCount: totalKeys - orphanResult.orphanCount - orphanResult.uncertainCount,
      filesScanned: orphanResult.totalFilesScanned,
      layersChecked: layersToCheck.map(d => d.layer),
      dirsScanned: orphanResult.dirsScanned,
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

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'find_orphan_keys')
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
    if (!byKey[usage.key]) byKey[usage.key] = []
    byKey[usage.key].push({
      file: toRelativePath(usage.file, dir),
      line: usage.line,
      callee: usage.callee,
    })
  }

  const sortedByKey: Record<string, Array<{ file: string; line: number; callee: string }>> = {}
  for (const key of Object.keys(byKey).sort()) {
    sortedByKey[key] = byKey[key]
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

  const reportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'scan_code_usage')
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
  scanDirs?: string[]
  excludeDirs?: string[]
  dryRun?: boolean
  projectDir?: string
  outputFile?: string
}): Promise<Record<string, unknown>> { // TODO: use specific result type from types.ts
  const { layer, locale, scanDirs, excludeDirs } = opts
  const dir = opts.projectDir ?? process.cwd()
  const config = await detectI18nConfig(dir)
  const isDryRun = opts.dryRun ?? true

  const { keysByLayer, totalKeys } = await resolveOrphanScanContext(config, {
    layer,
    locale,
    dir,
    toolName: 'remove_orphan_keys',
  })

  if (totalKeys === 0) {
    const emptyOutput = { orphanKeys: {}, removed: {}, summary: { totalKeys: 0, orphanCount: 0, message: 'No translation keys found.' } }
    const emptyReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (emptyReportPath) {
      validateReportPath(dir, emptyReportPath)
      await writeReportFile(emptyReportPath, emptyOutput, {
        tool: 'remove_orphan_keys',
        args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
      })
      return { reportFile: emptyReportPath, summary: emptyOutput.summary }
    }
    return emptyOutput
  }

  const orphanResult = await findOrphanKeysForConfig({
    keysByLayer,
    scanDirs: scanDirs || [dir],
    excludeDirs: excludeDirs || undefined,
    resolveIgnorePatterns: (layerName) => resolveOrphanIgnorePatterns(config, layerName),
    patterns: getPatternSet(config.localeFileFormat),
  })
  const orphansByLayer = orphanResult.orphansByLayer
  const orphanCount = orphanResult.orphanCount
  const totalFilesScanned = orphanResult.totalFilesScanned
  const dynamicMatchedCount = orphanResult.dynamicMatchedCount
  const ignoredCount = orphanResult.ignoredCount
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
    if (dynamicMatchedCount === 0 && ignoredCount === 0 && orphanResult.uncertainCount === 0) messageParts.push('All translation keys are referenced in code.')
    const zeroOutput: Record<string, unknown> = {
      orphanKeys: {},
      uncertainKeys: orphanResult.uncertainCount > 0 ? orphanResult.uncertainByLayer : undefined,
      summary: { totalKeys, orphanCount: 0, uncertainCount: orphanResult.uncertainCount, dynamicMatchedCount, ignoredCount, filesScanned: totalFilesScanned, message: messageParts.join(' ') },
    }
    const zeroReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (zeroReportPath) {
      validateReportPath(dir, zeroReportPath)
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
      summary: {
        dryRun: true,
        totalKeys,
        orphanCount,
        uncertainCount: orphanResult.uncertainCount,
        dynamicMatchedCount,
        ignoredCount,
        usedCount: totalKeys - orphanCount - orphanResult.uncertainCount,
        filesScanned: totalFilesScanned,
        message: `Found ${orphanCount} orphan key(s) safe to remove.${orphanResult.uncertainCount > 0 ? ` ${orphanResult.uncertainCount} uncertain key(s) excluded (overlap with dynamic translation patterns).` : ''} ${dynamicMatchedCount > 0 ? `${dynamicMatchedCount} key(s) matched dynamic patterns and were excluded. ` : ''}${ignoredCount > 0 ? `${ignoredCount} key(s) matched ignore patterns and were excluded. ` : ''}Call again with dryRun: false to remove them.`,
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
    const dryRunReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
    if (dryRunReportPath) {
      validateReportPath(dir, dryRunReportPath)
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
    summary: {
      dryRun: false,
      totalKeys,
      removedCount: orphanCount,
      uncertainCount: orphanResult.uncertainCount,
      dynamicMatchedCount,
      ignoredCount,
      remainingCount: totalKeys - orphanCount,
      filesWritten: totalFilesWritten,
      filesScanned: totalFilesScanned,
    },
  }

  const removalReportPath = opts.outputFile ?? resolveReportFilePath(config, dir, 'remove_orphan_keys')
  if (removalReportPath) {
    validateReportPath(dir, removalReportPath)
    await writeReportFile(removalReportPath, removalOutput, {
      tool: 'remove_orphan_keys',
      args: { layer, locale, scanDirs, excludeDirs, dryRun: opts.dryRun },
    })
    return { reportFile: removalReportPath, summary: removalOutput.summary }
  }

  return removalOutput
}
