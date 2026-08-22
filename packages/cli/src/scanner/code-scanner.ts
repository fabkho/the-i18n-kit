import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { glob } from 'tinyglobby'
import { log } from '../utils/logger.js'
import { createOxcFrontend } from './frontends/oxc.js'
import { createPhpFrontend } from './frontends/php/index.js'
import { createBladeFrontend } from './frontends/php/blade.js'
import type { LanguageFrontend } from './frontends/types.js'
import { interpret } from './rules.js'
import type { RuleContext } from './rules.js'
import { ambiguousCalleeNeedsDot } from './rules.js'
import { createPatternsFrontend, readPatternSites, collectConstKeyTable, substituteConstIdentifiers } from './frontends/patterns.js'
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
  /**
   * Files an active syntax frontend handled but declined — unparseable, or a
   * parser that would not load — so pattern matching read them instead. A
   * broken parser install shows up here rather than as silently weaker scans.
   */
  declinedFiles: string[]
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

// ─── Const-table resolution (#284) ──────────────────────────────

// ─── Extraction ─────────────────────────────────────────────────

/**
 * One file's evidence through the pattern frontend — the sync contract the
 * scanner suites are written against. Same pipeline as every scan: the
 * frontend reports call sites, the rules decide what they mean.
 */
export function extractKeys(content: string, filePath: string, patterns?: ScanPatternSet): { usages: KeyUsage[]; dynamicKeys: DynamicKeyUsage[]; bareStringCandidates: Set<string> } {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  return interpret(readPatternSites(content, filePath, pat), ruleContext(filePath))
}

function ruleContext(filePath: string): RuleContext {
  return { filePath, ambiguousCalleeNeedsDot }
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

    const parts = splitInterpolations(expr)
    // #284: an interpolated variable can hold a dotted path (`${i18nBase}.title`
    // with `const i18nBase = 'a.b.c'`), so `${_}` compiles to `.+?` — any number
    // of segments — in leading, interior, and trailing position. This
    // over-suppresses: keys a single-segment variable could never reach are
    // counted as dynamic-matched. For a deletion tool that is the correct
    // trade-off — the safe-orphan list must stay safe. Guard: widening is
    // anchored to a literal key fragment — some literal part must contain a
    // word char adjacent to a dot (`.title`, `a.b.`). Without that anchor
    // (`${x}`, `${a}.${b}`, `v${major}.${minor}`) the widened regex would match
    // essentially every key (a real anny-ui scan drops to zero orphans), so
    // the bounded single-segment `[^.]+` stays for those.
    const wildcard = parts.some(part => /[\w-]\.|\.[\w-]/.test(part)) ? '.+?' : '[^.]+'
    const pattern = parts
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(wildcard)

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
  // Glob order varies between runs; dedupe keeps the first entry per pattern,
  // so sort first to make the surviving representative the lexicographically
  // smallest location — report output must be byte-deterministic (CI diffing).
  const sorted = [...dynamicKeys].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.expression.localeCompare(b.expression))
  const seen = new Set<string>()
  const seenPatterns = new Set<string>()
  const warnings: UnresolvedKeyWarning[] = []
  for (const dk of sorted) {
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

// ─── Bare candidate collection ──────────────────────────────────

const BARE_DOTTED_STRING = /(['"])((?:[\w-]+\.)+[\w-]+)\1/g
/**
 * Matches bare template literals with i18n-key shape, regardless of call
 * context: content outside `${...}` interpolations restricted to key-like
 * chars ([\w.-], mirroring BARE_PHP_DYNAMIC), at least one interpolation
 * (single-level brace nesting), no newlines. A permissive backtick-to-next-
 * backtick match turns every stray backtick (comments, strings, markdown)
 * into a mega-expression swallowing whole code spans — bloating reports and
 * compiling to over-matching dynamic-key regexes when it starts with an
 * interpolation.
 */
const BARE_DYNAMIC_TEMPLATE = /`([\w.-]*(?:\$\{(?:[^`{}\n]|\{[^`{}\n]*\})*\}[\w.-]*)+)`/g
/** Longer candidates cannot plausibly be i18n keys — drop, don't truncate. */
const MAX_BARE_TEMPLATE_LENGTH = 120
/**
 * Matches PHP double-quoted interpolated strings with i18n-key shape,
 * regardless of call context — `$transKey = "api.x.{$key}"` assigned first
 * and passed to Lang::get() later must still suppress api.x.* orphans.
 * Content is restricted to key-like chars plus {$expr} / $var->prop
 * interpolations: a permissive "any double-quoted string containing $"
 * match swallows the code BETWEEN quoted strings (PHP code is full of $),
 * shifting quote parity past the real candidates.
 */
const BARE_PHP_DYNAMIC = /"((?:[\w.-]|\{\$[^}]+\}|\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*)+)"/g
/**
 * Matches prefix-shaped string literals (≥1 key-like segment, trailing dot,
 * closing quote right after the dot) regardless of call context: concat
 * prefixes ('menu.' + var, __('a.b.' . $x) — incl. multiline t() calls where
 * the prefix sits on its own line) and prefixes passed as plain arguments
 * (->translationPrefix('api.invoices.status.')) concatenated in a helper.
 * Group 2: the prefix including the trailing dot.
 */
const BARE_PREFIX_LITERAL = /(['"])((?:[\w-]+\.)+)\1/g
/**
 * Matches suffix-only concat construction (#284): a string literal that is
 * entirely dot-leading key-shaped segments ('.labelPlural'), adjacent to
 * `+` on either side — `obj.translationPath + '.labelPlural'`. The variable
 * prefix is unresolvable, so the candidate keeps a bare `${_}` prefix; with
 * the `${_}` → `.+?` widening that suppresses every key ending in the
 * suffix. `+`-adjacency is required: dot-leading literals appear everywhere
 * (file extensions, decimals) and only concat context makes them key
 * evidence. A trailing `+` means the constructed key continues past the
 * literal, so the candidate gets a trailing `${_}` too. Template-literal
 * suffixes (`` `${x}.select` ``) already reach the same shape via
 * BARE_DYNAMIC_TEMPLATE. Group 1: `+` before; group 3: suffix; group 4: `+` after.
 */
const BARE_SUFFIX_CONCAT = /(\+[ \t]*)?(['"])((?:\.[\w-]+)+)\2(?:[ \t]*(\+))?/g

function collectBareTemplateCandidates(content: string, constTable: Map<string, string>, bareStrings: Set<string>, bareDynamics: Set<string>): void {
  BARE_DYNAMIC_TEMPLATE.lastIndex = 0
  for (const match of content.matchAll(BARE_DYNAMIC_TEMPLATE)) {
    const raw = match[1]
    if (!raw || raw.length > MAX_BARE_TEMPLATE_LENGTH) continue
    const expr = substituteConstIdentifiers(raw, constTable)
    // Fully resolved by the const table → an exact candidate, not a pattern.
    if (!expr.includes('${')) {
      if (expr.includes('.')) bareStrings.add(expr)
      continue
    }
    const normalized = expr.replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, '${_}')
    // The dot must survive interpolation stripping (like BARE_PHP_DYNAMIC):
    // `${a.b}` alone has no literal key segment and would compile to a
    // match-any-single-segment regex.
    if (!normalized.replace(/\$\{_\}/g, '').includes('.')) continue
    bareDynamics.add(`\`${normalized}\``)
  }
}

function collectBarePhpCandidates(content: string, bareDynamics: Set<string>): void {
  BARE_PHP_DYNAMIC.lastIndex = 0
  for (const match of content.matchAll(BARE_PHP_DYNAMIC)) {
    const expr = match[1]
    // The $-check keeps plain dotted strings out (BARE_DOTTED_STRING's job);
    // the dot must survive interpolation stripping so `{$a}$b` (no literal
    // key segment) does not become an everything-matches candidate.
    if (!expr?.includes('$')) continue
    const normalized = expr
      .replace(/\{\$[^}]+\}/g, '${_}')
      .replace(/\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*/g, '${_}')
    if (!normalized.replace(/\$\{_\}/g, '').includes('.')) continue
    bareDynamics.add(`\`${normalized}\``)
  }
}

function collectBarePrefixCandidates(content: string, bareDynamics: Set<string>): void {
  BARE_PREFIX_LITERAL.lastIndex = 0
  for (const match of content.matchAll(BARE_PREFIX_LITERAL)) {
    bareDynamics.add(`\`${match[2]}\${_}\``)
  }
}

function collectBareSuffixConcatCandidates(content: string, bareDynamics: Set<string>): void {
  BARE_SUFFIX_CONCAT.lastIndex = 0
  for (const match of content.matchAll(BARE_SUFFIX_CONCAT)) {
    const suffix = match[3]
    if (!suffix || suffix.length > MAX_BARE_TEMPLATE_LENGTH) continue
    if (!match[1] && !match[4]) continue
    bareDynamics.add(`\`\${_}${suffix}${match[4] ? '${_}' : ''}\``)
  }
}

/**
 * Collects context-free key evidence from one file's content: exact dotted
 * strings into `bareStrings`, interpolated/concatenated shapes into
 * `bareDynamics` (normalized to `${_}` slots for buildDynamicKeyRegexes).
 *
 * Interpolation shapes are gated by `bareShapes` (#288): the PHP shape on
 * Vue/JS files matches template attributes like `v-if="$slots.header"`
 * (junk `${_}.header` families); conversely PHP key construction uses `.`
 * concat and `{$var}` interpolation only, so the backtick-template and
 * `+`-concat shapes have nothing legitimate to find there and can only
 * misfire (shell-exec backticks, `+`-adjacent decimals). Dotted literals
 * and trailing-dot prefixes are language-neutral and always run.
 */
function collectBareCandidates(content: string, constTable: Map<string, string>, bareStrings: Set<string>, bareDynamics: Set<string>, bareShapes: 'js' | 'php' = 'js'): void {
  BARE_DOTTED_STRING.lastIndex = 0
  for (const match of content.matchAll(BARE_DOTTED_STRING)) {
    const candidate = match[2]
    if (candidate) bareStrings.add(candidate)
  }
  collectBarePrefixCandidates(content, bareDynamics)

  if (bareShapes === 'php') {
    collectBarePhpCandidates(content, bareDynamics)
    return
  }
  collectBareTemplateCandidates(content, constTable, bareStrings, bareDynamics)
  collectBareSuffixConcatCandidates(content, bareDynamics)
}

// ─── Scanning ───────────────────────────────────────────────────

/**
 * Scan source files in a directory for i18n key usage.
 *
 * When `patterns` is omitted, defaults to Vue/Nuxt patterns.
 */
/**
 * One file's evidence, preferring a frontend that reads the language as syntax
 * over one that matches it as text (#332).
 *
 * A frontend that declines — an unparseable file, a parser that would not load
 * — falls through to pattern matching rather than failing. Better evidence when
 * it is available, never a scan that stops because it was not.
 */
async function extractFileEvidence(
  content: string,
  filePath: string,
  frontends: LanguageFrontend[],
  patterns?: ScanPatternSet,
): Promise<{ usages: KeyUsage[], dynamicKeys: DynamicKeyUsage[], bareStringCandidates: Set<string>, declined: boolean }> {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  let declined = false

  for (const frontend of frontends) {
    if (!frontend.handles(filePath)) continue

    const sites = await frontend.read(content, filePath)
    if (!sites) {
      // Declining is not an error: the next frontend — ultimately the pattern
      // one, which never declines — reads the file instead.
      declined = true
      continue
    }

    return { ...interpret(sites, ruleContext(filePath)), declined }
  }

  return { ...extractKeys(content, filePath, pat), declined }
}

/**
 * Opt-in, via `I18N_SCANNER=ast`.
 *
 * The architecture is settled; the migration is not. #332 gates each frontend
 * on a differential run showing it is at least as conservative as what it
 * replaces, and on anny-ui the AST frontend still misses 13 keys the patterns
 * find — most of them regex artifacts, a handful genuine. A key the outgoing
 * frontend saw and the incoming one does not becomes an orphan, and orphans
 * get deleted, so the default stays where the evidence is.
 *
 * Flip it once `scripts/scanner-diff.mjs` reports nothing in that direction.
 */
let warnedRegexHatch = false

/**
 * The syntax frontends are the default (#402 for JS/TS/Vue, #405 for
 * PHP/Blade); patterns read only what they decline. `I18N_SCANNER=regex`
 * restores the old scanner for exactly one release — an escape hatch for
 * reporting a regression, not a mode.
 */
function defaultFrontends(pat: ScanPatternSet): LanguageFrontend[] {
  if (process.env.I18N_SCANNER === 'regex') {
    if (!warnedRegexHatch) {
      warnedRegexHatch = true
      log.warn('I18N_SCANNER=regex is deprecated and will be removed in the next major. If the default scanner misses something the regex found, please file it: https://github.com/fabkho/the-i18n-kit/issues')
    }
    return [createPatternsFrontend(pat)]
  }
  const syntax = pat.bareShapes === 'php' ? [phpFrontend, bladeFrontend] : [oxcFrontend]
  return [...syntax, createPatternsFrontend(pat)]
}

const oxcFrontend = createOxcFrontend()
const phpFrontend = createPhpFrontend()
const bladeFrontend = createBladeFrontend()

export async function scanSourceFiles(rootDir: string, excludeDirs?: string[], patterns?: ScanPatternSet, frontends?: LanguageFrontend[]): Promise<ScanResult> {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  const active = frontends ?? defaultFrontends(pat)
  const ignore = [...pat.ignoreDirs, ...(excludeDirs ?? [])]

  let relativePaths: string[]
  try {
    // Sorted, because tinyglobby walks directories in parallel and promises no
    // stable order. Scan order becomes output order, so without this the same
    // binary disagrees with itself between runs on an unchanged tree — which
    // makes diffing before and after a change, the technique that catches what
    // unit tests miss, read as thousands of lines of noise (#327).
    relativePaths = (await glob(pat.filePatterns, { cwd: rootDir, ignore, dot: false, absolute: false })).sort()
  } catch {
    return { usages: [], dynamicKeys: [], filesScanned: 0, declinedFiles: [], uniqueKeys: new Set(), bareStringCandidates: new Set(), bareDynamicCandidates: new Set() }
  }

  const allUsages: KeyUsage[] = []
  const allDynamicKeys: DynamicKeyUsage[] = []
  const bareStringCandidates = new Set<string>()
  const bareDynamicCandidates = new Set<string>()
  const declinedFiles: string[] = []
  let filesScanned = 0

  for (const relPath of relativePaths) {
    const filePath = join(rootDir, relPath)
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      log.warn(`Failed to read file: ${filePath}`)
      continue
    }

    const constTable = (pat.bareShapes ?? 'js') === 'js' ? collectConstKeyTable(content) : new Map<string, string>()
    const { usages, dynamicKeys, bareStringCandidates: bareFromCalls, declined } = await extractFileEvidence(content, filePath, active, pat)
    if (declined) declinedFiles.push(relPath)
    allUsages.push(...usages)
    allDynamicKeys.push(...dynamicKeys)
    for (const candidate of bareFromCalls) bareStringCandidates.add(candidate)

    collectBareCandidates(content, constTable, bareStringCandidates, bareDynamicCandidates, pat.bareShapes)

    filesScanned++
  }

  const uniqueKeys = new Set(allUsages.map(u => u.key))
  log.debug(`Scanned ${filesScanned} files, found ${uniqueKeys.size} unique keys, ${allDynamicKeys.length} dynamic references, ${bareStringCandidates.size} bare string candidates, ${bareDynamicCandidates.size} bare dynamic candidates`)

  return { usages: allUsages, dynamicKeys: allDynamicKeys, filesScanned, declinedFiles, uniqueKeys, bareStringCandidates, bareDynamicCandidates }
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
      const ch = pattern.charAt(i)
      if (ch === '*' && pattern[i + 1] === '*') {
        regexStr += '.*'
        i += 2
      } else if (ch === '*') {
        regexStr += '[^.]*'
        i += 1
      } else if ('.+?^${}()|[]\\'.includes(ch)) {
        regexStr += '\\' + ch
        i += 1
      } else {
        regexStr += ch
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

interface OrphanScanBaseOptions {
  keysByLayer: Map<string, { keys: string[]; localeDir: { layer: string } }>
  excludeDirs?: string[]
  resolveIgnorePatterns: (layerName: string) => string[] | undefined
  patterns?: ScanPatternSet
}

/**
 * Exactly one scan source is required:
 * - `scanDirs` — explicit root directories, scanned recursively; manual
 *   scope control. Every layer is checked against ONE combined usage set
 *   (the pre-scope-aware global behavior) and no misplaced-usage
 *   detection happens.
 * - `scanPlan` — scope-aware plan from `buildOrphanScanPlan`.
 */
export type OrphanScanOptions = OrphanScanBaseOptions & (
  | { scanDirs: string[]; scanPlan?: undefined }
  | { scanDirs?: undefined; scanPlan: OrphanScanPlan }
)

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
  /**
   * Keys alive solely through the bare-candidate net — no call site references
   * them, a dotted string somewhere merely shares their name (a comment, a
   * data structure, a coincidence). Visible rather than silently kept: these
   * are where dead references hide (#402).
   */
  candidateOnlyByLayer: Record<string, string[]>
  candidateOnlyCount: number
  totalFilesScanned: number
  /** Files a syntax frontend declined; pattern matching read them instead. */
  totalFilesDeclined: number
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
export function nestedUnitIgnores(unit: ScanUnit, units: ScanUnit[]): string[] {
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
  const { keysByLayer, excludeDirs, resolveIgnorePatterns, patterns } = options

  // Explicit scanDirs = manual scope control: one combined usage set shared
  // by all layers, no misplaced-usage detection (pre-scope-aware behavior).
  const globalScope = options.scanDirs !== undefined
  const units: ScanUnit[] = options.scanDirs !== undefined
    ? options.scanDirs.map(d => ({ name: d, dir: d }))
    : options.scanPlan.units

  // Scan each unit dir exactly once. In plan mode, nested unit dirs are
  // excluded from ancestor scans; explicit scanDirs are scanned as given.
  const evidences: UnitEvidence[] = []
  const allDynamicKeysRaw: DynamicKeyUsage[] = []
  let totalFilesScanned = 0

  let totalFilesDeclined = 0

  for (const unit of units) {
    const ignores = globalScope ? [] : nestedUnitIgnores(unit, units)
    const result = await scanSourceFiles(unit.dir, [...(excludeDirs ?? []), ...ignores], patterns)
    totalFilesScanned += result.filesScanned
    totalFilesDeclined += result.declinedFiles.length
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
  const candidateOnlyByLayer: Record<string, string[]> = {}
  let candidateOnlyCount = 0
  const uncertainByLayer: Record<string, string[]> = {}
  let uncertainCount = 0
  let dynamicMatchedCount = 0
  let ignoredCount = 0
  const misplacedUsages: MisplacedUsage[] = []
  const scanScopeByLayer: Record<string, string[]> = {}

  for (const [layerName, { keys }] of keysByLayer) {
    const scopeNames = (options.scanDirs !== undefined
      ? allUnitNames
      : options.scanPlan.scopeByLayer.get(layerName) ?? allUnitNames)
      .filter(name => evidenceByName.has(name))
    scanScopeByLayer[layerName] = scopeNames.map(name => evidenceByName.get(name)!.unit.dir)

    const scope = scopeEvidence(scopeNames)
    const scopeNameSet = new Set(scopeNames)
    const outOfScope = globalScope ? [] : evidences.filter(e => !scopeNameSet.has(e.unit.name))

    const ignorePatterns = resolveIgnorePatterns(layerName)
    const ignoreRegexes = ignorePatterns ? buildIgnorePatternRegexes(ignorePatterns) : []

    const candidateOnly: string[] = []
    const orphans = keys.filter((k) => {
      if (scope.unique.has(k)) return false
      if (scope.bare.has(k)) {
        // Protected, but by nothing a frontend could call a usage.
        if (!scope.dynRegexes.some(re => re.test(k))) candidateOnly.push(k)
        return false
      }
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
    if (candidateOnly.length > 0) {
      candidateOnlyByLayer[layerName] = candidateOnly.sort()
      candidateOnlyCount += candidateOnly.length
    }
  }

  misplacedUsages.sort((a, b) => a.layer.localeCompare(b.layer) || a.key.localeCompare(b.key))

  // File glob ordering varies between runs — sort the diagnostic arrays so
  // report output is byte-deterministic (CI artifact diffing relies on it).
  const byLocation = (a: { file: string; line: number; expression: string }, b: { file: string; line: number; expression: string }) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.expression.localeCompare(b.expression)
  allDynamicKeysRaw.sort(byLocation)
  unresolvedWarnings.sort((a, b) => byLocation(a, b))

  return {
    orphansByLayer,
    orphanCount,
    uncertainByLayer,
    uncertainCount,
    candidateOnlyByLayer,
    candidateOnlyCount,
    totalFilesScanned,
    totalFilesDeclined,
    dynamicMatchedCount,
    ignoredCount,
    allDynamicKeys: allDynamicKeysRaw,
    dirsScanned: units.map(u => u.dir),
    unresolvedKeyWarnings: unresolvedWarnings,
    misplacedUsages,
    scanScopeByLayer,
  }
}
