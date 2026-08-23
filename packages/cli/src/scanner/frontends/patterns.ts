import type { CallSite, LanguageFrontend } from './types.js'
import type { ScanPatternSet } from '../patterns.js'

/**
 * The regex path as a language frontend (#332).
 *
 * Regexes frame text and report call sites; what a site means is decided once,
 * in the rules, the same as for every other frontend. Binding is always
 * `ambiguous`, because a regex can never prove what a name is bound to — which
 * is the entire reason the syntax frontends exist.
 *
 * This frontend never declines: it is the floor every scan can fall back to.
 */
export function createPatternsFrontend(pat: ScanPatternSet): LanguageFrontend {
  return {
    name: 'patterns',
    handles: () => true,
    read: (content, filePath) => Promise.resolve(readPatternSites(content, filePath, pat)),
  }
}

/**
 * Synchronous core, so the sync `extractKeys` contract the scanner tests are
 * written against keeps working unchanged.
 */
export function readPatternSites(content: string, filePath: string, pat: ScanPatternSet, constTable?: Map<string, string>): CallSite[] {
  const table = constTable ?? (pat.resolveLocalConsts ? collectConstKeyTable(content) : new Map<string, string>())
  const sites: CallSite[] = []

  const lines = content.split('\n')
  for (const [i, line] of lines.entries()) {
    const lineNumber = i + 1
    staticSites(line, lineNumber, pat, sites)
    dynamicSites(line, lineNumber, pat, table, sites)
    concatSites(line, lineNumber, pat, sites)
  }

  return sites
}

function staticSites(line: string, lineNumber: number, pat: ScanPatternSet, sites: CallSite[]): void {
  for (const regex of pat.staticKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const key = match[3]
      if (!key) continue
      // A quoted string carrying PHP interpolation is not a static key; the
      // dynamic pattern reads it.
      if (key.includes('{$')) continue
      sites.push({ callee, binding: 'ambiguous', argument: { kind: 'static', value: key }, line: lineNumber })
    }
  }
}

function dynamicSites(line: string, lineNumber: number, pat: ScanPatternSet, table: Map<string, string>, sites: CallSite[]): void {
  for (const regex of pat.dynamicKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const raw = match[2]
      if (!raw) continue
      // Const-resolved expressions lose their interpolation and, with
      // promoteStaticDynamicMatches, become exact static usages below.
      const expression = substituteConstIdentifiers(raw, table)
      const normalized = normalizeDynamicExpression(expression)
      if (normalized === undefined) {
        if (!pat.promoteStaticDynamicMatches) continue
        if (!expression) continue
        if (pat.requiresDotForCallee?.(callee) && !expression.includes('.')) continue
        sites.push({ callee, binding: 'ambiguous', argument: { kind: 'static', value: expression }, line: lineNumber })
        continue
      }
      sites.push({ callee, binding: 'ambiguous', argument: { kind: 'template', expression: normalized }, line: lineNumber })
    }
  }
}

function concatSites(line: string, lineNumber: number, pat: ScanPatternSet, sites: CallSite[]): void {
  for (const regex of pat.concatKeyPatterns) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const callee = match[1] ?? ''
      const prefix = match[3]
      if (!prefix) continue
      sites.push({ callee, binding: 'ambiguous', argument: { kind: 'concat', prefix }, line: lineNumber })
    }
  }
}

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
export function collectConstKeyTable(content: string): Map<string, string> {
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
export function substituteConstIdentifiers(expr: string, table: Map<string, string>): string {
  if (table.size === 0 || !expr.includes('${')) return expr
  return expr.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) => table.get(name) ?? whole)
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
