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
        if (!expression.includes('${') && !expression.includes('{$')) {
          if (pat.promoteStaticDynamicMatches) {
            const key = expression
            if (!key) continue
            if (pat.requiresDotForCallee?.(callee) && !key.includes('.')) continue
            usages.push({ key, file: filePath, line: lineNumber, callee })
          }
          continue
        }
        const normalized = expression.includes('{$')
          ? expression.replace(/\{\$[^}]+\}/g, '${_}')
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

interface LayerInfo {
  layer: string
  layerRootDir: string
  /** When set, this layer's locale files physically live in another layer's directory */
  aliasOf?: string
}

export function buildLayerScanPlan(
  localeDir: LayerInfo,
  allLocaleDirs: LayerInfo[],
  userExcludeDirs: string[] | undefined,
  includeParentLayer = false,
): LayerScanPlan[] {
  const baseExclude = userExcludeDirs ?? []
  const plans: LayerScanPlan[] = [{ dir: localeDir.layerRootDir, excludeDirs: baseExclude }]

  const aliasLayers = allLocaleDirs.filter(ld => ld.aliasOf === localeDir.layer)
  for (const alias of aliasLayers) {
    plans.push({ dir: alias.layerRootDir, excludeDirs: baseExclude })
  }

  if (!includeParentLayer) return plans

  const rootLocaleDir = allLocaleDirs.find(ld =>
    ld.layer !== localeDir.layer
    && localeDir.layerRootDir.startsWith(ld.layerRootDir + '/'),
  )
  if (!rootLocaleDir) return plans

  const siblingAppDirs = allLocaleDirs
    .filter(ld => ld.layer !== rootLocaleDir.layer && ld.layer !== localeDir.layer && !aliasLayers.some(a => a.layer === ld.layer))
    .map(ld => relative(rootLocaleDir.layerRootDir, ld.layerRootDir))
    .filter(rel => !rel.startsWith('..'))

  plans.push({ dir: rootLocaleDir.layerRootDir, excludeDirs: [...baseExclude, ...siblingAppDirs] })
  return plans
}
