import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
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

    // Concat prefix: 'some.key.' + var  (catches multiline t() calls)
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

export interface OrphanScanOptions {
  keysByLayer: Map<string, { keys: string[]; localeDir: { layer: string } }>
  /** Root directories to scan for source file usage. Scanned recursively. */
  scanDirs: string[]
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

export async function findOrphanKeysForConfig(options: OrphanScanOptions): Promise<OrphanScanResult> {
  const { keysByLayer, scanDirs, excludeDirs, resolveIgnorePatterns, patterns } = options

  // Single recursive scan from each provided root dir.
  // All layers share the combined results — no per-layer scan planning needed.
  const combinedUniqueKeys = new Set<string>()
  const combinedBareStrings = new Set<string>()
  const allDynamicKeysRaw: Array<{ expression: string; file: string; line: number; callee: string }> = []
  let totalFilesScanned = 0

  for (const dir of scanDirs) {
    const result = await scanSourceFiles(dir, excludeDirs ?? [], patterns)
    totalFilesScanned += result.filesScanned
    for (const key of result.uniqueKeys) combinedUniqueKeys.add(key)
    for (const bare of result.bareStringCandidates) combinedBareStrings.add(bare)
    allDynamicKeysRaw.push(...result.dynamicKeys)
    for (const bd of result.bareDynamicCandidates) {
      allDynamicKeysRaw.push({ expression: bd, file: '', line: 0, callee: '' })
    }
  }

  const dynamicKeyRegexes = buildDynamicKeyRegexes(allDynamicKeysRaw)
  const unresolvedWarnings = buildUnresolvedWarnings(allDynamicKeysRaw)
  const uncertainRegexes = buildIgnorePatternRegexes(unresolvedWarnings.map(w => w.suggestedIgnorePattern))

  const orphansByLayer: Record<string, string[]> = {}
  let orphanCount = 0
  const uncertainByLayer: Record<string, string[]> = {}
  let uncertainCount = 0
  let dynamicMatchedCount = 0
  let ignoredCount = 0

  for (const [layerName, { keys }] of keysByLayer) {
    const ignorePatterns = resolveIgnorePatterns(layerName)
    const ignoreRegexes = ignorePatterns ? buildIgnorePatternRegexes(ignorePatterns) : []

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
    allDynamicKeys: allDynamicKeysRaw,
    dirsScanned: scanDirs,
    unresolvedKeyWarnings: unresolvedWarnings,
  }
}
