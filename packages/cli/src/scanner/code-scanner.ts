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

// ─── Const-table resolution (#284) ──────────────────────────────

/**
 * Matches `const` declarations initialized to a key-shaped string literal
 * (≥1 dot). Scope is deliberately tight: identifier = literal only — no
 * object properties, no expressions, and no `let` (a reassigned binding
 * would substitute a stale literal and bypass the conservative widening).
 */
const CONST_KEY_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:[\w-]+\.)+[\w-]+)\2/g

/**
 * Collects same-file `const NAME = 'dotted.path'` declarations so
 * `${NAME}` interpolations can be substituted with the literal value.
 * Same-file only — imported/cross-file constants are NOT resolved and fall
 * back to the conservative `${_}` widening in buildDynamicKeyRegexes.
 * A name bound to different values (shadowing across scopes) is ambiguous
 * and dropped: substituting one of several possible values could narrow a
 * pattern past a live key.
 */
function collectConstKeyTable(content: string): Map<string, string> {
  const table = new Map<string, string>()
  const ambiguous = new Set<string>()
  CONST_KEY_DECL.lastIndex = 0
  for (const match of content.matchAll(CONST_KEY_DECL)) {
    const name = match[1]
    const value = match[3]
    if (!name || !value || ambiguous.has(name)) continue
    const existing = table.get(name)
    if (existing !== undefined && existing !== value) {
      table.delete(name)
      ambiguous.add(name)
      continue
    }
    table.set(name, value)
  }
  return table
}

/**
 * Substitutes `${NAME}` interpolations with the const table's literal value,
 * producing an exact or narrower pattern: `${i18nBase}.title` +
 * `const i18nBase = 'a.b.c'` → `a.b.c.title`. Only plain-identifier
 * interpolations qualify; member expressions and anything else stay dynamic.
 */
function substituteConstIdentifiers(expr: string, table: Map<string, string>): string {
  if (table.size === 0 || !expr.includes('${')) return expr
  return expr.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) => table.get(name) ?? whole)
}

// ─── Extraction ─────────────────────────────────────────────────

/**
 * Extract all i18n key references from file content.
 * Returns static usages and dynamic (unresolvable) references.
 *
 * When `patterns` is omitted, defaults to Vue/Nuxt patterns.
 */
interface LineExtraction {
  pat: ScanPatternSet
  constTable: Map<string, string>
  filePath: string
  usages: KeyUsage[]
  dynamicKeys: DynamicKeyUsage[]
}

function extractStaticMatches(line: string, lineNumber: number, ctx: LineExtraction): void {
  for (const regex of ctx.pat.staticKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const key = match[3]
      if (!key) continue
      if (key.includes('{$')) continue
      if (ctx.pat.requiresDotForCallee?.(callee) && !key.includes('.')) continue
      ctx.usages.push({ key, file: ctx.filePath, line: lineNumber, callee })
    }
  }
}

/**
 * Normalizes every interpolation syntax (JS `${expr}`, PHP `{$expr}` and
 * bare `$var->prop`) to `${_}` slots. Returns undefined when the expression
 * contains no interpolation at all.
 */
function normalizeDynamicExpression(expression: string): string | undefined {
  const hasDollarBrace = expression.includes('${')
  const hasBraceDollar = expression.includes('{$')
  const hasBarePHP = !hasDollarBrace && !hasBraceDollar && /\$[a-zA-Z_]/.test(expression)
  if (!hasDollarBrace && !hasBraceDollar && !hasBarePHP) return undefined
  return hasBraceDollar
    ? expression.replace(/\{\$[^}]+\}/g, '${_}')
    : hasBarePHP
      ? expression.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*/g, '${_}')
      : expression
}

function extractDynamicMatches(line: string, lineNumber: number, ctx: LineExtraction): void {
  for (const regex of ctx.pat.dynamicKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const raw = match[2]
      if (!raw) continue
      // Const-resolved expressions lose their interpolation and, with
      // promoteStaticDynamicMatches, become exact static usages below.
      const expression = substituteConstIdentifiers(raw, ctx.constTable)
      const normalized = normalizeDynamicExpression(expression)
      if (normalized === undefined) {
        if (!ctx.pat.promoteStaticDynamicMatches) continue
        if (!expression) continue
        if (ctx.pat.requiresDotForCallee?.(callee) && !expression.includes('.')) continue
        ctx.usages.push({ key: expression, file: ctx.filePath, line: lineNumber, callee })
        continue
      }
      ctx.dynamicKeys.push({ expression: `\`${normalized}\``, file: ctx.filePath, line: lineNumber, callee })
    }
  }
}

function extractConcatMatches(line: string, lineNumber: number, ctx: LineExtraction): void {
  for (const regex of ctx.pat.concatKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const prefix = match[3]
      if (!prefix) continue
      if (ctx.pat.requiresDotForCallee?.(callee) && !prefix.includes('.')) continue
      ctx.dynamicKeys.push({ expression: `\`${prefix}\${_}\``, file: ctx.filePath, line: lineNumber, callee })
    }
  }
}

export function extractKeys(content: string, filePath: string, patterns?: ScanPatternSet, constTable?: Map<string, string>): { usages: KeyUsage[]; dynamicKeys: DynamicKeyUsage[] } {
  const pat = patterns ?? VUE_NUXT_PATTERNS
  const ctx: LineExtraction = {
    pat,
    constTable: constTable ?? (pat.resolveLocalConsts ? collectConstKeyTable(content) : new Map<string, string>()),
    filePath,
    usages: [],
    dynamicKeys: [],
  }

  const lines = content.split('\n')
  for (const [i, line] of lines.entries()) {
    const lineNumber = i + 1
    extractStaticMatches(line, lineNumber, ctx)
    extractDynamicMatches(line, lineNumber, ctx)
    extractConcatMatches(line, lineNumber, ctx)
  }

  return { usages: ctx.usages, dynamicKeys: ctx.dynamicKeys }
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

  for (const relPath of relativePaths) {
    const filePath = join(rootDir, relPath)
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      log.warn(`Failed to read file: ${filePath}`)
      continue
    }

    const constTable = pat.resolveLocalConsts ? collectConstKeyTable(content) : new Map<string, string>()
    const { usages, dynamicKeys } = extractKeys(content, filePath, pat, constTable)
    allUsages.push(...usages)
    allDynamicKeys.push(...dynamicKeys)

    collectBareCandidates(content, constTable, bareStringCandidates, bareDynamicCandidates, pat.bareShapes)

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
