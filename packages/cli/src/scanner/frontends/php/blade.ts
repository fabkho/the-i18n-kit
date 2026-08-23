import type { CallSite, LanguageFrontend } from '../types.js'
import { collectPhpSites, loadPhpParser } from './index.js'
import type { PhpNode, PhpParserEngine } from './index.js'
import { log } from '../../../utils/logger.js'

/**
 * Blade, by lifting (#404, #332).
 *
 * No maintained Blade AST parser exists, and none is needed: every construct
 * that can carry a translation key wraps a PHP expression. The lexical pass
 * here finds those wrappers — echoes, `@lang`/`@choice`, `@php` blocks, raw
 * PHP tags — and hands the expression inside to the same parser and the same
 * site collection plain PHP uses. The regex frames text; it never decides
 * what a key is.
 *
 * A lifted chunk the parser cannot read declines the whole file to the
 * pattern fallback: partially-read templates would silently drop keys.
 */
export function createBladeFrontend(): LanguageFrontend {
  return {
    name: 'blade',

    handles(filePath: string): boolean {
      return filePath.endsWith('.blade.php')
    },

    async read(content: string, filePath: string): Promise<CallSite[] | null> {
      const parser = await loadPhpParser(filePath)
      if (!parser) return null

      const sites: CallSite[] = []
      for (const chunk of liftChunks(content)) {
        const parsed = parseChunk(parser, chunk, filePath)
        if (!parsed) {
          // A control-flow directive's argument (`@foreach($items as $item)`)
          // is Blade grammar, not a PHP expression — skipping it loses nothing
          // a call site could carry. The constructs that do carry keys must
          // parse, or the whole file declines: partially-read templates would
          // silently drop keys.
          if (chunk.optional) continue
          return null
        }
        sites.push(...collectPhpSites(parsed, chunk.lineOffset, chunk.callee))
      }
      sites.sort((a, b) => a.line - b.line)
      return sites
    },
  }
}

interface Chunk {
  /** A statement the PHP parser can read, `<?php` prefix excluded. */
  source: string
  /** Lines before the chunk in the template — added to every reported line. */
  lineOffset: number
  /** Report sites under the directive's own name (`@lang`), as written. */
  callee?: string
  /** A chunk that may fail to parse without declining the file. */
  optional?: boolean
}

function parseChunk(parser: PhpParserEngine, chunk: Chunk, filePath: string): PhpNode | null {
  try {
    return parser.parseCode(`<?php ${chunk.source}`, filePath) as unknown as PhpNode
  } catch (error) {
    log.debug(`blade frontend declined ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const BLADE_COMMENT = /\{\{--[\s\S]*?--\}\}/g

function liftChunks(content: string): Chunk[] {
  // Comments may contain anything, including things shaped like echoes.
  const source = content.replace(BLADE_COMMENT, m => m.replace(/[^\n]/g, ' '))
  const lineAt = (offset: number) => source.slice(0, offset).split('\n').length - 1

  return [
    ...echoChunks(source, lineAt),
    ...phpBlockChunks(source, lineAt),
    ...boundAttributeChunks(source, lineAt),
    ...directiveChunks(source, lineAt),
  ]
}

type LineAt = (offset: number) => number

/** {{ expr }} and {!! expr !!} — echoes of a PHP expression. */
function echoChunks(source: string, lineAt: LineAt): Chunk[] {
  const chunks: Chunk[] = []
  for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}|\{!!([\s\S]*?)!!\}/g)) {
    const expression = match[1] ?? match[2]
    if (!expression?.trim()) continue
    chunks.push({ source: `${expression};`, lineOffset: lineAt(match.index ?? 0) })
  }
  return chunks
}

/** @php ... @endphp and raw <?php ... ?> — statements as written. */
function phpBlockChunks(source: string, lineAt: LineAt): Chunk[] {
  return [
    ...bodyChunks(source, /@php\b(?!\s*\()([\s\S]*?)@endphp/g, lineAt),
    ...bodyChunks(source, /<\?php\b([\s\S]*?)(?:\?>|$)/g, lineAt),
  ]
}

function bodyChunks(source: string, pattern: RegExp, lineAt: LineAt): Chunk[] {
  const chunks: Chunk[] = []
  for (const match of source.matchAll(pattern)) {
    const body = match[1]
    if (body?.trim()) chunks.push({ source: body, lineOffset: lineAt(match.index ?? 0) })
  }
  return chunks
}

/**
 * Bound component attributes — :message="__('alerts.saved')" compiles to a
 * PHP expression. `::` escapes to a literal colon and carries none.
 */
function boundAttributeChunks(source: string, lineAt: LineAt): Chunk[] {
  const chunks: Chunk[] = []
  for (const match of source.matchAll(/(?<![:\w]):[\w-]+=(?:"([^"]*)"|'([^']*)')/g)) {
    const expression = match[1] ?? match[2]
    if (!expression?.trim()) continue
    chunks.push({ source: `__args__(${expression});`, lineOffset: lineAt(match.index ?? 0), optional: true })
  }
  return chunks
}

/**
 * Directive arguments. @lang and @choice are thin wrappers over __ and
 * trans_choice — the argument list is the translation call, reported under
 * the directive's own name. Every other directive gets its arguments read
 * as an expression list (`@section('title', __('Forbidden'))` carries a
 * real call), best-effort: what is not an expression is Blade grammar.
 * The inline @php($x = ...) form is an expression list like any other.
 */
function directiveChunks(source: string, lineAt: LineAt): Chunk[] {
  const chunks: Chunk[] = []
  // Block @php ... @endphp is handled elsewhere; the inline form
  // @php($x = ...) is an expression list like any other directive argument.
  for (const match of source.matchAll(/@(\w+)\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const args = balancedParens(source, open)
    if (args === undefined) continue
    const chunk = directiveChunk(match[1] ?? '', args, lineAt(match.index ?? 0))
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

function directiveChunk(directive: string, args: string, lineOffset: number): Chunk | undefined {
  if (directive === 'lang' || directive === 'choice') {
    const helper = directive === 'lang' ? '__' : 'trans_choice'
    return { source: `${helper}(${args});`, lineOffset, callee: `@${directive}` }
  }
  return args.trim() ? { source: `__args__(${args});`, lineOffset, optional: true } : undefined
}

/**
 * The argument text between a directive's parentheses, quote-aware — a `)`
 * inside a string does not close the call. Returns undefined when the call
 * never closes, which declines the construct rather than guessing.
 */
function balancedParens(source: string, openIndex: number): string | undefined {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\'' || ch === '"') {
      i = skipString(source, i)
    } else if (ch === '(') {
      depth++
    } else if (ch === ')' && --depth === 0) {
      return source.slice(openIndex + 1, i)
    }
  }
  return undefined
}

/** The index of a string literal's closing quote, escapes respected. */
function skipString(source: string, start: number): number {
  const quote = source[start]
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === quote) return i
  }
  return source.length
}
