import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { glob } from 'tinyglobby'
import { DepGraph } from 'dependency-graph'
import { log } from '../utils/logger.js'
import type { ScanPatternSet } from './patterns.js'
import { VUE_NUXT_PATTERNS } from './patterns.js'
import type { AppInfo } from '../config/types.js'

// ─── Types ──────────────────────────────────────────────────────

export interface KeyUsage {
  key: string
  file: string
  line: number
  callee: string
}

export interface DynamicKeyUsage {
  expression: string
  file: string
  line: number
  callee: string
}

export interface ScanResult {
  usages: KeyUsage[]
  dynamicKeys: DynamicKeyUsage[]
  filesScanned: number
  uniqueKeys: Set<string>
  /**
   * All quoted strings containing at least one dot, extracted from source files.
   * These are NOT confirmed i18n keys — they must be intersected with actual
   * locale keys to identify bare key references (e.g., `{ name: 'common.actions.save', i18n: true }`).
   */
  bareStringCandidates: Set<string>
  /**
   * Template literal expressions containing at least one dot and `${...}` interpolation,
   * extracted from source files regardless of i18n call context.
   * Format: `` `prefix.${_}.suffix` `` — ready to feed into `buildDynamicKeyRegexes`.
   */
  bareDynamicCandidates: Set<string>
}

// ─── Extraction ─────────────────────────────────────────────────

/**
 * Extract all i18n key references from file content.
 * Returns static usages and dynamic (unresolvable) references.
 *
 * When no `patterns` argument is provided, defaults to Vue/Nuxt patterns
 * for backward compatibility.
 */
export function extractKeys(content: string, filePath: string, patterns?: ScanPatternSet): { usages: KeyUsage[]; dynamicKeys: DynamicKeyUsage[] } {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  const usages: KeyUsage[] = []
  const dynamicKeys: DynamicKeyUsage[] = []

  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    for (const regex of pat.staticKeyPatterns) {
      regex.lastIndex = 0
      for (const match of line.matchAll(regex)) {
        const callee = match[1]
        const key = match[3]
        if (!key) continue
        if (key.includes('{$')) continue
        if (pat.requiresDotForCallee?.(callee) && !key.includes('.')) continue
        usages.push({ key, file: filePath, line: lineNumber, callee })
      }
    }

    for (const regex of pat.dynamicKeyPatterns) {
      regex.lastIndex = 0
      for (const match of line.matchAll(regex)) {
        const callee = match[1]
        const expression = match[2]
        const hasDollarBrace = expression.includes('${')
        const hasBraceDollar = expression.includes('{$')
        const hasBarePHP = !hasDollarBrace && !hasBraceDollar && /\$[a-zA-Z_]/.test(expression)
        if (!hasDollarBrace && !hasBraceDollar && !hasBarePHP) {
          if (pat.promoteStaticDynamicMatches) {
            const key = expression
            if (!key) continue
            if (pat.requiresDotForCallee?.(callee) && !key.includes('.')) continue
            usages.push({ key, file: filePath, line: lineNumber, callee })
          }
          continue
        }
        const normalized = hasBraceDollar
          ? expression.replace(/\{\$[^}]+\}/g, '${_}')
          : hasBarePHP
            ? expression.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*/g, '${_}')
            : expression
        dynamicKeys.push({ expression: `\`${normalized}\``, file: filePath, line: lineNumber, callee: match[1] })
      }
    }

    for (const regex of pat.concatKeyPatterns) {
      regex.lastIndex = 0
      for (const match of line.matchAll(regex)) {
        const callee = match[1]
        const prefix = match[3]
        if (!prefix) continue
        if (pat.requiresDotForCallee?.(callee) && !prefix.includes('.')) continue
        dynamicKeys.push({ expression: `\`${prefix}\${_}\``, file: filePath, line: lineNumber, callee })
      }
    }
  }

  return { usages, dynamicKeys }
}

// ─── Dynamic key pattern matching ───────────────────────────────

/**
 * Split a template literal expression on `${...}` interpolation boundaries,
 * returning only the static literal segments. Handles nested braces inside
 * interpolations (e.g. `${fn({a:1})}`) by tracking brace depth.
 */
function splitInterpolations(expr: string): string[] {
  const parts: string[] = []
  let current = ''
  let i = 0

  while (i < expr.length) {
    if (expr[i] === '$' && expr[i + 1] === '{') {
      parts.push(current)
      current = ''
      i += 2
      let depth = 1
      while (i < expr.length && depth > 0) {
        if (expr[i] === '{') depth++
        else if (expr[i] === '}') depth--
        i++
      }
    } else {
      current += expr[i]
      i++
    }
  }

  parts.push(current)
  return parts
}

/**
 * Convert dynamic key expressions (template literals with interpolation) into
 * regex patterns that can match concrete translation keys.
 *
 * Example: `components.integrations.${type}.title` → /^components\.integrations\.[^.]+\.title$/
 */
export function buildDynamicKeyRegexes(dynamicKeys: Pick<DynamicKeyUsage, 'expression'>[]): RegExp[] {
  const seen = new Set<string>()
  const regexes: RegExp[] = []

  for (const dk of dynamicKeys) {
    let expr = dk.expression
    if (expr.startsWith('`') && expr.endsWith('`')) {
      expr = expr.slice(1, -1)
    }

    if (!expr.includes('${')) continue

    const pattern = splitInterpolations(expr)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^.]+')

    if (seen.has(pattern)) continue
    seen.add(pattern)

    regexes.push(new RegExp(`^${pattern}$`))
  }

  return regexes
}

function suggestIgnorePattern(expression: string): string | undefined {
  let expr = expression
  if (expr.startsWith('`') && expr.endsWith('`')) expr = expr.slice(1, -1)
  const idx = expr.indexOf('${')
  if (idx <= 0) return undefined
  const prefix = expr.slice(0, idx).replace(/\.$/, '')
  return `${prefix}.**`
}

function buildUnresolvedWarnings(dynamicKeys: DynamicKeyUsage[]): UnresolvedKeyWarning[] {
  const seen = new Set<string>()
  const seenPatterns = new Set<string>()
  const warnings: UnresolvedKeyWarning[] = []
  for (const dk of dynamicKeys) {
    if (!dk.file || !dk.line) continue
    const pattern = suggestIgnorePattern(dk.expression)
    if (!pattern) continue
    if (seenPatterns.has(pattern)) continue
    seenPatterns.add(pattern)
    const dedup = `${dk.file}:${dk.line}:${dk.expression}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    warnings.push({
      expression: dk.expression,
      file: dk.file,
      line: dk.line,
      callee: dk.callee,
      suggestedIgnorePattern: pattern,
    })
  }
  return warnings
}

// ─── Scanning ───────────────────────────────────────────────────

/**
 * Scan source files in a directory for i18n key usage.
 *
 * When `patterns` is omitted, defaults to Vue/Nuxt patterns for backward
 * compatibility.
 */
export async function scanSourceFiles(rootDir: string, excludeDirs?: string[], patterns?: ScanPatternSet): Promise<ScanResult> {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  const ignore = [...pat.ignoreDirs, ...(excludeDirs ?? [])]

  let relativePaths: string[]
  try {
    relativePaths = await glob(pat.filePatterns, { cwd: rootDir, ignore, dot: false, absolute: false })
  } catch {
    return { usages: [], dynamicKeys: [], filesScanned: 0, uniqueKeys: new Set(), bareStringCandidates: new Set(), bareDynamicCandidates: new Set() }
  }

  const allUsages: KeyUsage[] = []
  const allDynamicKeys: DynamicKeyUsage[] = []
  const bareStringCandidates = new Set<string>()
  const bareDynamicCandidates = new Set<string>()
  let filesScanned = 0

  const BARE_DOTTED_STRING = /(['"])((?:[\w-]+\.)+[\w-]+)\1/g
  const BARE_DYNAMIC_TEMPLATE = /`((?:[^`\\]|\\.)*\$\{(?:[^`\\]|\\.)*)`/g
  /** Matches PHP double-quoted strings containing $var or {$var} interpolation with at least one dot */
  const BARE_PHP_DYNAMIC = /"((?:[^"\\]|\\.)*(?:\{\$|\$[a-zA-Z_])(?:[^"\\]|\\.)*)"/g

  for (const relPath of relativePaths) {
    const filePath = join(rootDir, relPath)
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      log.warn(`Failed to read file: ${filePath}`)
      continue
    }

    const { usages, dynamicKeys } = extractKeys(content, filePath, pat)
    allUsages.push(...usages)
    allDynamicKeys.push(...dynamicKeys)

    BARE_DOTTED_STRING.lastIndex = 0
    for (const match of content.matchAll(BARE_DOTTED_STRING)) {
      bareStringCandidates.add(match[2])
    }

    BARE_DYNAMIC_TEMPLATE.lastIndex = 0
    for (const match of content.matchAll(BARE_DYNAMIC_TEMPLATE)) {
      const expr = match[1]
      if (!expr.includes('.')) continue
      const normalized = expr.replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, '${_}')
      bareDynamicCandidates.add(`\`${normalized}\``)
    }

    BARE_PHP_DYNAMIC.lastIndex = 0
    for (const match of content.matchAll(BARE_PHP_DYNAMIC)) {
      const expr = match[1]
      if (!expr.includes('.')) continue
      const normalized = expr
        .replace(/\{\$[^}]+\}/g, '${_}')
        .replace(/\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*/g, '${_}')
      bareDynamicCandidates.add(`\`${normalized}\``)
    }

    filesScanned++
  }

  const uniqueKeys = new Set(allUsages.map(u => u.key))
  log.debug(`Scanned ${filesScanned} files, found ${uniqueKeys.size} unique keys, ${allDynamicKeys.length} dynamic references, ${bareStringCandidates.size} bare string candidates, ${bareDynamicCandidates.size} bare dynamic candidates`)

  return { usages: allUsages, dynamicKeys: allDynamicKeys, filesScanned, uniqueKeys, bareStringCandidates, bareDynamicCandidates }
}

// ─── Utilities ──────────────────────────────────────────────────

export function toRelativePath(filePath: string, rootDir: string): string {
  return relative(rootDir, filePath)
}

/**
 * Convert dot-path glob patterns (e.g., "common.datetime.**", "pages.*.title")
 * into RegExp objects for matching translation keys.
 *
 * - `**` matches any number of dot-separated segments (including zero)
 * - `*` matches exactly one segment (no dots)
 */
export function buildIgnorePatternRegexes(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    let regexStr = ''
    let i = 0
    while (i < pattern.length) {
      if (pattern[i] === '*' && pattern[i + 1] === '*') {
        regexStr += '.*'
        i += 2
      } else if (pattern[i] === '*') {
        regexStr += '[^.]*'
        i += 1
      } else if ('.+?^${}()|[]\\'.includes(pattern[i])) {
        regexStr += '\\' + pattern[i]
        i += 1
      } else {
        regexStr += pattern[i]
        i += 1
      }
    }
    return new RegExp(`^${regexStr}$`)
  })
}

// ─── Layer scan planning ────────────────────────────────────────

export interface LayerScanPlan {
  dir: string
  excludeDirs: string[]
}

export async function scanAllApps(
  apps: AppInfo[],
  excludeDirs: string[] | undefined,
  patterns?: ScanPatternSet,
): Promise<Map<string, ScanResult>> {
  const cache = new Map<string, ScanResult>()
  const seen = new Set<string>()

  for (const app of apps) {
    if (seen.has(app.rootDir)) continue
    seen.add(app.rootDir)
    const result = await scanSourceFiles(app.rootDir, excludeDirs ?? [], patterns)
    cache.set(app.rootDir, result)
  }

  return cache
}

export function buildLayerScanPlan(
  layerName: string,
  apps: AppInfo[],
  userExcludeDirs: string[] | undefined,
): LayerScanPlan[] {
  const baseExclude = userExcludeDirs ?? []
  const graph = new DepGraph<string>()
  const APP_PREFIX = 'app::'

  for (const app of apps) {
    graph.addNode(APP_PREFIX + app.name, app.rootDir)
    for (const layer of app.layers) {
      if (!graph.hasNode(layer)) graph.addNode(layer, '')
      graph.addDependency(APP_PREFIX + app.name, layer)
    }
  }

  let consumerAppNames: string[]
  try {
    consumerAppNames = graph.dependantsOf(layerName)
      .filter(n => n.startsWith(APP_PREFIX))
      .map(n => n.slice(APP_PREFIX.length))
  } catch {
    consumerAppNames = apps.map(a => a.name)
  }

  if (consumerAppNames.length === 0) {
    consumerAppNames = [layerName]
  }

  const scannedDirs = new Set<string>()
  const plans: LayerScanPlan[] = []

  const layerRootDirs = new Map<string, string>()
  for (const app of apps) {
    layerRootDirs.set(app.name, app.rootDir)
  }

  for (const appName of consumerAppNames) {
    const app = apps.find(a => a.name === appName)
    if (!app) continue
    if (!scannedDirs.has(app.rootDir)) {
      scannedDirs.add(app.rootDir)
      plans.push({ dir: app.rootDir, excludeDirs: baseExclude })
    }
    for (const depLayer of app.layers) {
      const depApp = apps.find(a => a.name === depLayer)
      if (!depApp) continue
      if (scannedDirs.has(depApp.rootDir)) continue
      scannedDirs.add(depApp.rootDir)
      plans.push({ dir: depApp.rootDir, excludeDirs: baseExclude })
    }
  }

  if (plans.length === 0) {
    for (const app of apps) {
      if (scannedDirs.has(app.rootDir)) continue
      scannedDirs.add(app.rootDir)
      plans.push({ dir: app.rootDir, excludeDirs: baseExclude })
    }
  }

  return plans
}

export interface OrphanScanOptions {
  keysByLayer: Map<string, { keys: string[]; localeDir: { layer: string } }>
  apps: AppInfo[]
  scanDirs?: string[]
  excludeDirs?: string[]
  resolveIgnorePatterns: (layerName: string) => string[] | undefined
  patterns?: ScanPatternSet
}

export interface UnresolvedKeyWarning {
  /** The dynamic expression as detected (e.g., `` `notifications.subscriptions.${_}.message` ``) */
  expression: string
  /** Source file path */
  file: string
  /** Line number in source file */
  line: number
  /** The i18n function called (e.g., `__`, `$t`) */
  callee: string
  /** Suggested ignorePattern to suppress false-positive orphans from this expression */
  suggestedIgnorePattern: string
}

export interface OrphanScanResult {
  orphansByLayer: Record<string, string[]>
  orphanCount: number
  uncertainByLayer: Record<string, string[]>
  uncertainCount: number
  totalFilesScanned: number
  dynamicMatchedCount: number
  ignoredCount: number
  allDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }>
  dirsScanned: string[]
  unresolvedKeyWarnings: UnresolvedKeyWarning[]
}

// ─── Misplaced Key Detection ────────────────────────────────────

export interface MisplacedKeyEntry {
  key: string
  currentLayer: string
  suggestedLayer: string
  usedIn: string[]
}

export interface MisplacedKeysResult {
  misplacedKeys: MisplacedKeyEntry[]
  summary: {
    total: number
    moveToRoot: number
    moveToChild: number
    byCurrentLayer: Record<string, number>
  }
}

export interface MisplacedKeysScanOptions {
  keysByLayer: Map<string, { keys: string[]; localeDir: { layer: string } }>
  apps: AppInfo[]
  excludeDirs?: string[]
  resolveIgnorePatterns: (layerName: string) => string[] | undefined
  patterns?: ScanPatternSet
}

/**
 * Detect translation keys that live in the wrong layer.
 * - Child → Root: key in child layer but used from root or multiple apps
 * - Root → Child: key in root layer but only used from a single child app
 */
export async function findMisplacedKeysForConfig(options: MisplacedKeysScanOptions): Promise<MisplacedKeysResult> {
  const { keysByLayer, apps, excludeDirs, resolveIgnorePatterns, patterns } = options

  if (apps.length <= 1) {
    return { misplacedKeys: [], summary: { total: 0, moveToRoot: 0, moveToChild: 0, byCurrentLayer: {} } }
  }

  // Scan all app directories
  const scanCache = await scanAllApps(apps, excludeDirs, patterns)

  // Build per-app key usage: for each app, which keys does its source code reference?
  const appKeyUsage = new Map<string, Set<string>>()
  for (const app of apps) {
    const result = scanCache.get(app.rootDir)
    if (!result) continue
    appKeyUsage.set(app.name, result.uniqueKeys)
  }

  // Also track bare string matches per app (keys referenced as dotted strings outside t() calls)
  const appBareStrings = new Map<string, Set<string>>()
  for (const app of apps) {
    const result = scanCache.get(app.rootDir)
    if (!result) continue
    appBareStrings.set(app.name, result.bareStringCandidates)
  }

  // Find the root layer name (the layer that other apps depend on)
  const rootApp = apps.find(a => {
    // Root is the app that appears as a dependency of other apps
    return apps.some(other => other.layers.includes(a.name))
  })
  const rootLayerName = rootApp?.name ?? apps[0].name

  const misplacedKeys: MisplacedKeyEntry[] = []

  for (const [layerName, { keys }] of keysByLayer) {
    const ignorePatterns = resolveIgnorePatterns(layerName)
    const ignoreRegexes = ignorePatterns ? buildIgnorePatternRegexes(ignorePatterns) : []

    for (const key of keys) {
      // Skip ignored keys
      if (ignoreRegexes.length > 0 && ignoreRegexes.some(re => re.test(key))) continue

      // Determine which apps use this key
      const usedByApps: string[] = []
      for (const app of apps) {
        const directKeys = appKeyUsage.get(app.name)
        const bareStrings = appBareStrings.get(app.name)
        if (directKeys?.has(key) || bareStrings?.has(key)) {
          usedByApps.push(app.name)
        }
      }

      // If no app uses the key, skip (it's an orphan, not misplaced)
      if (usedByApps.length === 0) continue

      const isInRoot = layerName === rootLayerName
      const isUsedByMultipleApps = usedByApps.length > 1
      const isUsedByRoot = usedByApps.includes(rootLayerName)

      if (isInRoot) {
        // Root → Child: key in root but used by only one child app (not root itself)
        if (!isUsedByMultipleApps && !isUsedByRoot) {
          misplacedKeys.push({
            key,
            currentLayer: layerName,
            suggestedLayer: usedByApps[0],
            usedIn: usedByApps,
          })
        }
      } else {
        // Child → Root: key in child layer but used from root or other apps
        const isUsedOutsideOwnLayer = usedByApps.some(a => a !== layerName)
        if (isUsedOutsideOwnLayer) {
          misplacedKeys.push({
            key,
            currentLayer: layerName,
            suggestedLayer: rootLayerName,
            usedIn: usedByApps,
          })
        }
      }
    }
  }

  misplacedKeys.sort((a, b) => a.currentLayer.localeCompare(b.currentLayer) || a.key.localeCompare(b.key))

  const moveToRoot = misplacedKeys.filter(m => m.suggestedLayer === rootLayerName).length
  const moveToChild = misplacedKeys.length - moveToRoot
  const byCurrentLayer: Record<string, number> = {}
  for (const m of misplacedKeys) {
    byCurrentLayer[m.currentLayer] = (byCurrentLayer[m.currentLayer] ?? 0) + 1
  }

  return {
    misplacedKeys,
    summary: {
      total: misplacedKeys.length,
      moveToRoot,
      moveToChild,
      byCurrentLayer,
    },
  }
}

// ─── Orphan Key Detection ───────────────────────────────────────

export async function findOrphanKeysForConfig(options: OrphanScanOptions): Promise<OrphanScanResult> {
  const { keysByLayer, apps, scanDirs, excludeDirs, resolveIgnorePatterns, patterns } = options

  let scanCache: Map<string, ScanResult>
  if (scanDirs) {
    scanCache = new Map()
    for (const dir of scanDirs) {
      scanCache.set(dir, await scanSourceFiles(dir, excludeDirs ?? [], patterns))
    }
  } else {
    scanCache = await scanAllApps(apps, excludeDirs, patterns)
  }

  const orphansByLayer: Record<string, string[]> = {}
  let orphanCount = 0
  const uncertainByLayer: Record<string, string[]> = {}
  let uncertainCount = 0
  let totalFilesScanned = 0
  let dynamicMatchedCount = 0
  let ignoredCount = 0
  const allDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }> = []
  const dirsScanned: string[] = []

  for (const result of scanCache.values()) {
    totalFilesScanned += result.filesScanned
  }

  const unresolvedWarnings: UnresolvedKeyWarning[] = []

  for (const [layerName, { keys }] of keysByLayer) {
    let relevantResults: ScanResult[]
    if (scanDirs) {
      relevantResults = [...scanCache.values()]
    } else {
      const plans = buildLayerScanPlan(layerName, apps, excludeDirs)
      dirsScanned.push(...plans.map(p => p.dir))
      relevantResults = plans
        .map(p => scanCache.get(p.dir))
        .filter((r): r is ScanResult => r !== undefined)
    }

    const combinedUniqueKeys = new Set<string>()
    const combinedBareStrings = new Set<string>()
    const layerDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }> = []

    for (const result of relevantResults) {
      for (const key of result.uniqueKeys) combinedUniqueKeys.add(key)
      for (const bare of result.bareStringCandidates) combinedBareStrings.add(bare)
      layerDynamicKeys.push(...result.dynamicKeys)
      for (const bd of result.bareDynamicCandidates) {
        layerDynamicKeys.push({ expression: bd, file: '', line: 0, callee: '' })
      }
    }

    allDynamicKeys.push(...layerDynamicKeys)
    const dynamicKeyRegexes = buildDynamicKeyRegexes(layerDynamicKeys)
    const ignorePatterns = resolveIgnorePatterns(layerName)
    const ignoreRegexes = ignorePatterns ? buildIgnorePatternRegexes(ignorePatterns) : []

    const layerWarnings = buildUnresolvedWarnings(layerDynamicKeys)
    unresolvedWarnings.push(...layerWarnings)
    const uncertainRegexes = buildIgnorePatternRegexes(layerWarnings.map(w => w.suggestedIgnorePattern))

    const orphans = keys.filter((k) => {
      if (combinedUniqueKeys.has(k)) return false
      if (combinedBareStrings.has(k)) return false
      if (dynamicKeyRegexes.some(re => re.test(k))) {
        dynamicMatchedCount++
        return false
      }
      if (ignoreRegexes.length > 0 && ignoreRegexes.some(re => re.test(k))) {
        ignoredCount++
        return false
      }
      return true
    }).sort()

    const certain: string[] = []
    const uncertain: string[] = []
    for (const k of orphans) {
      if (uncertainRegexes.length > 0 && uncertainRegexes.some(re => re.test(k))) {
        uncertain.push(k)
      } else {
        certain.push(k)
      }
    }

    if (certain.length > 0) {
      orphansByLayer[layerName] = certain
      orphanCount += certain.length
    }
    if (uncertain.length > 0) {
      uncertainByLayer[layerName] = uncertain
      uncertainCount += uncertain.length
    }
  }

  return {
    orphansByLayer,
    orphanCount,
    uncertainByLayer,
    uncertainCount,
    totalFilesScanned,
    dynamicMatchedCount,
    ignoredCount,
    allDynamicKeys,
    dirsScanned: [...new Set(dirsScanned)],
    unresolvedKeyWarnings: unresolvedWarnings,
  }
}
