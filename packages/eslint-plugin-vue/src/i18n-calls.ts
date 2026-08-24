import type { Rule } from 'eslint'
import type { CallExpression, Node, Program } from 'estree'

/**
 * What counts as an i18n call, mirrored from the scanner's recognition
 * (the-i18n-cli, scanner rules): `$t`/`$te`/`$tc` anywhere, and a bare
 * `t`/`te`/`tc` only where it resolves to a vue-i18n binding. Lint and scan
 * must never disagree about what a call is — a rule firing on `client.t(...)`
 * would teach people to ignore it.
 *
 * Resolution is scope-based where a scope exists: a `t` that resolves to a
 * function parameter is that parameter, however many `useI18n()` calls the
 * file contains. Inside a `<template>` body no binding chain reaches the
 * setup scope, so template callees fall back to the file-level bindings —
 * which is exactly what the template can see at runtime.
 *
 * Vue-only by decision (#422): the React call families are not recognised.
 */

const ALWAYS_I18N = new Set(['$t', '$te', '$tc'])
const BARE_NAMES = new Set(['t', 'te', 'tc'])
const I18N_MODULES = new Set(['vue-i18n', '@nuxtjs/i18n', 'petite-vue-i18n'])

interface FileBindings {
  /** Names destructured from `useI18n()` or imported from a vue-i18n package. */
  names: Set<string>
  /** Composer instances: `const composer = useI18n()`. */
  instances: Set<string>
}

const bindingsCache = new WeakMap<Program, FileBindings>()

function fileBindings(context: Rule.RuleContext): FileBindings {
  const program = context.sourceCode.ast as Program
  let bindings = bindingsCache.get(program)
  if (bindings) return bindings

  bindings = { names: new Set(), instances: new Set() }
  walk(program, (node) => {
    if (node.type === 'ImportDeclaration' && I18N_MODULES.has(String(node.source.value))) {
      for (const spec of node.specifiers) bindings!.names.add(spec.local.name)
    }
    if (node.type === 'VariableDeclarator' && isUseI18nCall(node.init as Node | null)) {
      collectDeclaredNames(node.id as Node, bindings!)
    }
  })
  bindingsCache.set(program, bindings)
  return bindings
}

function isUseI18nCall(node: Node | null | undefined): boolean {
  return node?.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && node.callee.name === 'useI18n'
}

function collectDeclaredNames(id: Node, bindings: FileBindings): void {
  if (id.type === 'Identifier') {
    bindings.instances.add(id.name)
    return
  }
  if (id.type !== 'ObjectPattern') return
  for (const prop of id.properties) {
    if (prop.type === 'Property' && prop.value.type === 'Identifier') {
      bindings.names.add(prop.value.name)
    }
  }
}

export function isI18nCall(node: CallExpression, context: Rule.RuleContext): boolean {
  const callee = node.callee
  if (callee.type === 'Identifier') return isI18nIdentifier(callee, context)
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return isI18nMember(callee.property.name, callee.object, context)
  }
  return false
}

function isI18nIdentifier(callee: Node & { name: string }, context: Rule.RuleContext): boolean {
  if (ALWAYS_I18N.has(callee.name)) return true
  return BARE_NAMES.has(callee.name) && resolvesToI18n(callee, context, 'name')
}

function isI18nMember(name: string, object: Node, context: Rule.RuleContext): boolean {
  if (ALWAYS_I18N.has(name)) return true
  if (!BARE_NAMES.has(name)) return false
  // nuxtApp.$i18n.t(...) — the receiver names itself.
  if (object.type === 'MemberExpression' && !object.computed
    && object.property.type === 'Identifier' && object.property.name === '$i18n') {
    return true
  }
  // composer.t(...) — the receiver must be a useI18n() instance.
  return object.type === 'Identifier' && resolvesToI18n(object, context, 'instance')
}

/**
 * Scope-resolve an identifier to its binding. Resolvable-but-not-i18n (a
 * parameter, an unrelated const) wins over any file-level fallback — that is
 * the shadowing case. Only an unresolvable name (template bodies) consults
 * the file-level bindings.
 */
function resolvesToI18n(id: Node & { name: string }, context: Rule.RuleContext, kind: 'name' | 'instance'): boolean {
  const bindings = fileBindings(context)
  const fallback = kind === 'name' ? bindings.names : bindings.instances

  let scope: ReturnType<typeof context.sourceCode.getScope> | null = context.sourceCode.getScope(id)
  while (scope) {
    const variable = scope.variables.find(v => v.name === id.name)
    if (variable) {
      const def = variable.defs[0]
      if (!def) return false
      if (def.type === 'ImportBinding') {
        return I18N_MODULES.has(String((def.parent as { source?: { value?: unknown } }).source?.value))
      }
      return def.node.type === 'VariableDeclarator' && isUseI18nCall(def.node.init as Node | null)
    }
    scope = scope.upper
  }
  return fallback.has(id.name)
}

export function firstArgument(node: CallExpression): Node | undefined {
  const first = node.arguments[0]
  return first && first.type !== 'SpreadElement' ? first : undefined
}

/**
 * Register a CallExpression visitor for both the script and, when
 * vue-eslint-parser is active, the `<template>` expressions — `$t` in a
 * template is not second-class.
 */
export function callVisitor(
  context: Rule.RuleContext,
  visit: (node: CallExpression) => void,
): Rule.RuleListener {
  const listener: Rule.RuleListener = {
    CallExpression: node => visit(node as CallExpression),
  }
  const services = context.sourceCode.parserServices as
    | { defineTemplateBodyVisitor?: (template: Rule.RuleListener, script?: Rule.RuleListener) => Rule.RuleListener }
    | undefined
  if (services?.defineTemplateBodyVisitor) {
    return services.defineTemplateBodyVisitor(
      { CallExpression: (node: unknown) => visit(node as CallExpression) },
      listener,
    )
  }
  return listener
}

/** ESLint attaches `parent` back-references — walking them never ends. */
const SKIP_KEYS = new Set(['parent', 'loc', 'range'])

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    if (Array.isArray(value)) value.forEach(item => walkChild(item, visit))
    else walkChild(value, visit)
  }
}

function walkChild(child: unknown, visit: (node: Node) => void): void {
  if (child && typeof child === 'object' && 'type' in child) walk(child as Node, visit)
}
