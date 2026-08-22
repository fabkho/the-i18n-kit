import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import type { CallArgument, CallSite, LanguageFrontend } from '../types.js'
import { log } from '../../../utils/logger.js'

/**
 * Laravel PHP, read as syntax (#403, #332).
 *
 * The helpers are global functions, so recognition is by name rather than by
 * following an import — but the *arguments* are read from a real parse:
 * `"statuses.{$status}.label"` is an interpolated string with known parts, not
 * a regex's guess about where the quotes end. Heredocs, escapes and nested
 * quotes come for free.
 *
 * Blade is not read here: templates are lifted to PHP expressions by their own
 * frontend. This one declines `.blade.php`.
 */

/** The Laravel translation helpers. Global names; nothing else is called that. */
const PHP_I18N_CALLEES = new Set(['__', 'trans', 'trans_choice'])

export function createPhpFrontend(): LanguageFrontend {
  return {
    name: 'php',

    handles(filePath: string): boolean {
      return filePath.endsWith('.php') && !filePath.endsWith('.blade.php')
    },

    async read(content: string, filePath: string): Promise<CallSite[] | null> {
      const parser = await loadPhpParser(filePath)
      if (!parser) return null

      let program: PhpNode
      try {
        program = parser.parseCode(content, filePath) as unknown as PhpNode
      } catch (error) {
        log.debug(`php frontend declined ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }

      return collectPhpSites(program)
    },
  }
}

/**
 * Call sites in a parsed program. Shared with the Blade frontend, which parses
 * lifted expressions through the same engine and interprets them identically —
 * a key's fate must not depend on which file type referenced it (#332).
 */
export function collectPhpSites(program: PhpNode, lineOffset = 0, calleeOverride?: string): CallSite[] {
  const sites: CallSite[] = []
  walk(program, (node) => {
    if (node.kind !== 'call') return
    const callee = calleeName(node.what as PhpNode | undefined)
    if (!callee) return

    const [first] = (node.arguments as PhpNode[] | undefined) ?? []
    if (!first) return

    sites.push({
      callee: calleeOverride ?? callee,
      // A global helper name is not shadowable in idiomatic Laravel; the
      // name is the binding.
      binding: 'resolved',
      argument: readArgument(first),
      line: ((node.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 1) + lineOffset,
    })
  })
  return sites
}

function calleeName(what: PhpNode | undefined): string | undefined {
  if (!what) return undefined
  if (what.kind === 'name' && typeof what.name === 'string' && PHP_I18N_CALLEES.has(what.name)) {
    return what.name
  }
  // Lang::get('key') — the facade spelling of the same helper.
  return isLangGet(what) ? 'Lang::get' : undefined
}

function isLangGet(what: PhpNode): boolean {
  if (what.kind !== 'staticlookup') return false
  return (what.what as PhpNode | undefined)?.name === 'Lang'
    && (what.offset as PhpNode | undefined)?.name === 'get'
}

function readArgument(node: PhpNode): CallArgument {
  if ((node.kind === 'string' || node.kind === 'nowdoc') && typeof node.value === 'string') {
    return { kind: 'static', value: node.value }
  }
  if (node.kind === 'encapsed' && Array.isArray(node.value)) {
    return readEncapsed(node.value as PhpNode[])
  }
  if (node.kind === 'bin' && node.type === '.') {
    return readConcat(node)
  }
  return { kind: 'unknown' }
}

/** `'orders.status.' . $status` — the literal side bounds what the call can produce. */
function readConcat(node: PhpNode): CallArgument {
  const left = node.left as PhpNode | undefined
  if (left?.kind === 'string' && typeof left.value === 'string') {
    return { kind: 'concat', prefix: left.value }
  }
  return { kind: 'unknown' }
}

/**
 * Double-quoted or heredoc string with interpolation: known literal parts
 * around `${_}` slots — or a plain string after all, when nothing
 * interpolates.
 */
function readEncapsed(parts: PhpNode[]): CallArgument {
  const rendered = parts.map((part) => {
    const expression = part.expression as PhpNode | undefined
    return expression?.kind === 'string' && typeof expression.value === 'string' ? expression.value : '${_}'
  }).join('')
  return rendered.includes('${_}')
    ? { kind: 'template', expression: rendered }
    : { kind: 'static', value: rendered }
}

// ─── Parser loading ─────────────────────────────────────────────

/**
 * `php-parser` is an optional peer: only Laravel projects install it. It is
 * resolved from the scanned file outward, so a CLI running from the npx cache
 * still finds the parser installed in the user's project — then from this
 * package's own tree, which covers the workspace and test setup. Cached
 * including the failure, so a missing install is reported once.
 */
export interface PhpParserEngine { parseCode(code: string, filename: string): unknown }
export type PhpNode = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped AST from the parser

let parserPromise: Promise<PhpParserEngine | null> | undefined

export function loadPhpParser(fromFile: string): Promise<PhpParserEngine | null> {
  parserPromise ??= resolveParser(fromFile)
  return parserPromise
}

/** The cache spans files by design; tests exercising resolution reset it. */
export function resetPhpParserCacheForTests(): void {
  parserPromise = undefined
}

async function resolveParser(fromFile: string): Promise<PhpParserEngine | null> {
  const Engine = requireFromProject(fromFile) ?? await importFromOwnTree()
  if (!Engine) {
    log.warn(
      'PHP files found, but php-parser is not installed — falling back to pattern matching. '
      + 'Install it in your project for syntax-aware scanning: npm i -D php-parser',
    )
    return null
  }
  return new Engine({ parser: { php7: true, suppressErrors: false }, ast: { withPositions: true } })
}

type EngineConstructor = new (options: object) => PhpParserEngine

function requireFromProject(fromFile: string): EngineConstructor | undefined {
  try {
    const from = isAbsolute(fromFile) ? fromFile : join(process.cwd(), fromFile)
    const require = createRequire(from)
    return require('php-parser') as EngineConstructor
  } catch {
    return undefined
  }
}

async function importFromOwnTree(): Promise<EngineConstructor | undefined> {
  try {
    const mod = await import('php-parser') as unknown as { default?: EngineConstructor }
    return mod.default ?? (mod as unknown as EngineConstructor)
  } catch {
    return undefined
  }
}

function walk(node: PhpNode | undefined, visit: (node: PhpNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (typeof node.kind === 'string') visit(node)

  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'parent') continue
    walkChild(child, visit)
  }
}

function walkChild(child: unknown, visit: (node: PhpNode) => void): void {
  if (Array.isArray(child)) {
    for (const item of child) walkChild(item, visit)
    return
  }
  if (child && typeof child === 'object') walk(child as PhpNode, visit)
}
