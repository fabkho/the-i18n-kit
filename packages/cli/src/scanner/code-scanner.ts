import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { glob } from 'tinyglobby'
import { log } from '../utils/logger.js'
import type { ScanPatternSet } from './patterns.js'
import { VUE_NUXT_PATTERNS } from './patterns.js'

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
 * When `patterns` is omitted, defaults to Vue/Nuxt patterns.
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
 * When `patterns` is omitted, defaults to Vue/Nuxt patterns.
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
  const BARE_DYNAMIC_TEMPLATE = /`([^`\\\n]{0,200}\$\{[^`\\\n]{0,200})`/g
  /** Matches PHP double-quoted strings containing $var or {$var} interpolation with at least one dot */
  const BARE_PHP_DYNAMIC = /"((?:[^"\\]|\\.)*(?:\{\$|\$[a-zA-Z_])(?:[^"\\]|\\.)*)"/g
  /**
   * Matches string concat prefixes ending with a dot: 'some.key.' + var
   * Catches multiline t() calls where the prefix is on a separate line from t(.
   * Group 1: the prefix without trailing dot.
   */
  const BARE_CONCAT_PREFIX = /['"](((?:[\w-]+\.)+[\w-]+)\.)['"]\s*\+/g

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

    BARE_CONCAT_PREFIX.lastIndex = 0
    for (const match of content.matchAll(BARE_CONCAT_PREFIX)) {
      bareDynamicCandidates.add(`\`${match[2]}.\${_}\``)
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

/** One scan root with a stable name (app or layer) for scope reporting. */
export interface ScanUnit {
  /** Unit name used in scope maps and misplaced-usage reports (app or layer name). */
  name: string
  /** Absolute directory scanned for this unit. */
  dir: string
}

/**
 * Scope-aware scan plan: which dirs to scan (each exactly once) and which
 * units vouch for each layer's keys being "used".
 */
export interface OrphanScanPlan {
  /**
   * Scan units, deduplicated by directory. When a unit's dir nests inside
   * another unit's dir, the nested subtree is excluded from the ancestor's
   * scan so every file is attributed to exactly one unit (same total file
   * work as one whole-project scan).
   */
  units: ScanUnit[]
  /**
   * Layer name → names of units whose usage evidence counts for that layer.
   * Layers missing from the map are checked against ALL units (conservative
   * global scope — never wrongly narrows).
   */
  scopeByLayer: Map<string, string[]>
}

/** A key referenced only from scan units outside its layer's consuming scope. */
export interface MisplacedUsage {
  key: string
  /** Layer the key is defined in. */
  layer: string
  /** Out-of-scope scan units (apps or layers) where the key was found. */
  usingApps: string[]
}

export interface OrphanScanOptions {
  keysByLayer: Map<string, { keys: string[]; localeDir: { layer: string } }>
  /**
   * Explicit root directories to scan recursively — manual scope control.
   * When set, every layer is checked against ONE combined usage set from
   * these dirs (the pre-scope-aware global behavior): `scanPlan` is ignored
   * and no misplaced-usage detection happens.
   */
  scanDirs?: string[]
  /**
   * Scope-aware scan plan (see `buildOrphanScanPlan`). Used when `scanDirs`
   * is absent. One of `scanDirs` / `scanPlan` is required.
   */
  scanPlan?: OrphanScanPlan
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
  /** Accumulated across layers — a key present in several layers counts once per layer. */
  dynamicMatchedCount: number
  /** Accumulated across layers, like dynamicMatchedCount. */
  ignoredCount: number
  allDynamicKeys: Array<{ expression: string; file: string; line: number; callee: string }>
  dirsScanned: string[]
  unresolvedKeyWarnings: UnresolvedKeyWarning[]
  /** Keys referenced only from units outside their layer's scope. Not counted as orphans. */
  misplacedUsages: MisplacedUsage[]
  /** Layer name → dirs whose scans vouched for that layer's keys being "used". */
  scanScopeByLayer: Record<string, string[]>
}

/** Per-unit scan evidence, with lazily built dynamic-key regexes. */
interface UnitEvidence {
  unit: ScanUnit
  result: ScanResult
  /** Dynamic key expressions incl. bare candidates, in legacy accumulation order. */
  dynamicRaw: DynamicKeyUsage[]
  dynRegexes?: RegExp[]
}

/**
 * Glob ignores for other units' dirs nested inside this unit's dir, so a
 * scope-aware scan visits every file exactly once and attributes it to the
 * innermost unit.
 */
function nestedUnitIgnores(unit: ScanUnit, units: ScanUnit[]): string[] {
  const ignores: string[] = []
  for (const other of units) {
    if (other.dir === unit.dir) continue
    const rel = relative(unit.dir, other.dir)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue
    const posixRel = rel.split(sep).join('/')
    ignores.push(posixRel, `${posixRel}/**`)
  }
  return ignores
}

export async function findOrphanKeysForConfig(options: OrphanScanOptions): Promise<OrphanScanResult> {
  const { keysByLayer, scanDirs, scanPlan, excludeDirs, resolveIgnorePatterns, patterns } = options

  // Explicit scanDirs = manual scope control: one combined usage set shared
  // by all layers, no misplaced-usage detection (pre-scope-aware behavior).
  const globalScope = scanDirs !== undefined || !scanPlan
  const units: ScanUnit[] = scanDirs !== undefined
    ? scanDirs.map(d => ({ name: d, dir: d }))
    : scanPlan!.units

  // Scan each unit dir exactly once. In plan mode, nested unit dirs are
  // excluded from ancestor scans; explicit scanDirs are scanned as given.
  const evidences: UnitEvidence[] = []
  const allDynamicKeysRaw: DynamicKeyUsage[] = []
  let totalFilesScanned = 0

  for (const unit of units) {
    const ignores = globalScope ? [] : nestedUnitIgnores(unit, units)
    const result = await scanSourceFiles(unit.dir, [...(excludeDirs ?? []), ...ignores], patterns)
    totalFilesScanned += result.filesScanned
    const dynamicRaw: DynamicKeyUsage[] = [
      ...result.dynamicKeys,
      ...[...result.bareDynamicCandidates].map(bd => ({ expression: bd, file: '', line: 0, callee: '' })),
    ]
    allDynamicKeysRaw.push(...dynamicRaw)
    evidences.push({ unit, result, dynamicRaw })
  }

  // Unresolved-key warnings and the derived "uncertain" classification stay
  // global (all units): a key overlapping ANY dynamic translation pattern is
  // withheld from removal regardless of where that pattern lives.
  const unresolvedWarnings = buildUnresolvedWarnings(allDynamicKeysRaw)
  const uncertainRegexes = buildIgnorePatternRegexes(unresolvedWarnings.map(w => w.suggestedIgnorePattern))

  const evidenceByName = new Map(evidences.map(e => [e.unit.name, e]))
  const allUnitNames = units.map(u => u.name)

  // Scope unions are memoized — sibling layers typically share a scope.
  const scopeCache = new Map<string, { unique: Set<string>; bare: Set<string>; dynRegexes: RegExp[] }>()
  const scopeEvidence = (names: string[]) => {
    const cacheKey = names.join('\u0000')
    let cached = scopeCache.get(cacheKey)
    if (!cached) {
      const unique = new Set<string>()
      const bare = new Set<string>()
      const dynamicRaw: DynamicKeyUsage[] = []
      for (const name of names) {
        const evidence = evidenceByName.get(name)
        if (!evidence) continue
        for (const key of evidence.result.uniqueKeys) unique.add(key)
        for (const candidate of evidence.result.bareStringCandidates) bare.add(candidate)
        dynamicRaw.push(...evidence.dynamicRaw)
      }
      cached = { unique, bare, dynRegexes: buildDynamicKeyRegexes(dynamicRaw) }
      scopeCache.set(cacheKey, cached)
    }
    return cached
  }
  const unitDynRegexes = (evidence: UnitEvidence): RegExp[] =>
    evidence.dynRegexes ??= buildDynamicKeyRegexes(evidence.dynamicRaw)

  const orphansByLayer: Record<string, string[]> = {}
  let orphanCount = 0
  const uncertainByLayer: Record<string, string[]> = {}
  let uncertainCount = 0
  let dynamicMatchedCount = 0
  let ignoredCount = 0
  const misplacedUsages: MisplacedUsage[] = []
  const scanScopeByLayer: Record<string, string[]> = {}

  for (const [layerName, { keys }] of keysByLayer) {
    const scopeNames = (globalScope
      ? allUnitNames
      : scanPlan!.scopeByLayer.get(layerName) ?? allUnitNames)
      .filter(name => evidenceByName.has(name))
    scanScopeByLayer[layerName] = scopeNames.map(name => evidenceByName.get(name)!.unit.dir)

    const scope = scopeEvidence(scopeNames)
    const scopeNameSet = new Set(scopeNames)
    const outOfScope = globalScope ? [] : evidences.filter(e => !scopeNameSet.has(e.unit.name))

    const ignorePatterns = resolveIgnorePatterns(layerName)
    const ignoreRegexes = ignorePatterns ? buildIgnorePatternRegexes(ignorePatterns) : []

    const orphans = keys.filter((k) => {
      if (scope.unique.has(k)) return false
      if (scope.bare.has(k)) return false
      if (scope.dynRegexes.some(re => re.test(k))) {
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
      // Not vouched for in scope — but referenced from non-consuming units?
      // Then it's a misplaced usage, reported separately (not an orphan).
      const usingApps = outOfScope
        .filter(e =>
          e.result.uniqueKeys.has(k)
          || e.result.bareStringCandidates.has(k)
          || unitDynRegexes(e).some(re => re.test(k)))
        .map(e => e.unit.name)
      if (usingApps.length > 0) {
        misplacedUsages.push({ key: k, layer: layerName, usingApps })
        continue
      }
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

  misplacedUsages.sort((a, b) => a.layer.localeCompare(b.layer) || a.key.localeCompare(b.key))

  return {
    orphansByLayer,
    orphanCount,
    uncertainByLayer,
    uncertainCount,
    totalFilesScanned,
    dynamicMatchedCount,
    ignoredCount,
    allDynamicKeys: allDynamicKeysRaw,
    dirsScanned: units.map(u => u.dir),
    unresolvedKeyWarnings: unresolvedWarnings,
    misplacedUsages,
    scanScopeByLayer,
  }
}
