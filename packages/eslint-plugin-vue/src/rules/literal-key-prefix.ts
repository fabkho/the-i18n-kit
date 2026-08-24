import type { Rule } from 'eslint'
import type { Node, Program } from 'estree'
import { callVisitor, firstArgument, isI18nCall, resolveVariableDef } from '../i18n-calls.js'

/**
 * A dynamic i18n key must begin with a literal dotted segment.
 *
 * The scanner protects `t(`bookings.status.${s}`)` precisely: every key the
 * call can produce lives under `bookings.status.`. A key that *starts* with a
 * variable — `t(`${section}.title`)` — tells the scanner nothing about its
 * beginning, and its only options are over-protecting every `*.title` key in
 * the catalogue or deleting live ones. This idiom once classified 34 live
 * keys as safe orphans (#284); the rule makes it unwritable.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'dynamic i18n keys must begin with a literal dotted prefix, so the scanner can bound what they produce',
      url: 'https://github.com/fabkho/the-i18n-kit/issues/422',
    },
    messages: {
      templatePrefix: 'This key starts with a variable, so the orphan scanner cannot bound what it produces. Start the template with a literal dotted segment (e.g. `section.{{example}}`) or look full keys up from a local map of literals.',
      concatPrefix: 'This concatenated key starts with a non-literal, so the orphan scanner cannot bound what it produces. Put a literal dotted prefix first, or look full keys up from a local map of literals.',
    },
    schema: [],
  },

  create(context) {
    return callVisitor(context, (node) => {
      if (!isI18nCall(node, context)) return
      const arg = firstArgument(node)
      if (!arg) return
      const messageId = builtKeyProblem(arg, context)
      if (messageId) {
        context.report({ node: arg as Node & Rule.NodeParentExtension, messageId, data: { example: '${rest}' } })
      }
    })
  },
}

/** The messageId a built key earns, or undefined for anything acceptable. */
function builtKeyProblem(arg: Node, context: Rule.RuleContext): 'templatePrefix' | 'concatPrefix' | undefined {
  if (arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
    return templateBounded(arg, context) ? undefined : 'templatePrefix'
  }
  if (arg.type === 'BinaryExpression' && arg.operator === '+') {
    return dotted(literalValue(leftmostOperand(arg))) ? undefined : 'concatPrefix'
  }
  return undefined
}

/**
 * A template is bounded when its literal head carries a dot — or when its
 * leading `${i18nBase}` resolves to a same-file const string that does: the
 * #284 fix, which the scanner resolves to exact keys and the rule therefore
 * accepts. Lint and scan never disagree.
 */
function templateBounded(arg: Node & { type: 'TemplateLiteral' }, context: Rule.RuleContext): boolean {
  if (dotted(arg.quasis[0]?.value.cooked)) return true
  const leading = arg.expressions[0]
  return leading?.type === 'Identifier' && dotted(constStringValue(leading, context))
}

const dotted = (text: string | null | undefined): boolean => text?.includes('.') ?? false

const literalValue = (node: Node): string | undefined =>
  node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : node.type === 'TemplateLiteral' && node.expressions.length === 0
      ? node.quasis[0]?.value.cooked ?? undefined
      : undefined

/**
 * The string a same-file `const` holds, resolved through scope where one
 * exists and through the file's top-level consts inside `<template>` bodies —
 * the same cross-block view the scanner's SFC handling has.
 */
function constStringValue(id: Node & { name: string }, context: Rule.RuleContext): string | undefined {
  const def = resolveVariableDef(id, context)
  if (def === 'unresolvable') return fileConstStrings(context).get(id.name)
  if (def?.node.type === 'VariableDeclarator' && (def.parent as { kind?: string } | undefined)?.kind === 'const' && def.node.init) {
    return literalValue(def.node.init as Node)
  }
  return undefined
}

const fileConstsCache = new WeakMap<Program, Map<string, string>>()

function fileConstStrings(context: Rule.RuleContext): Map<string, string> {
  const program = context.sourceCode.ast as Program
  let consts = fileConstsCache.get(program)
  if (consts) return consts
  consts = new Map()
  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue
    for (const decl of statement.declarations) {
      if (decl.id.type !== 'Identifier' || !decl.init) continue
      const value = literalValue(decl.init as Node)
      if (value !== undefined) consts.set(decl.id.name, value)
    }
  }
  fileConstsCache.set(program, consts)
  return consts
}

function leftmostOperand(node: Node): Node {
  let current: Node = node
  while (current.type === 'BinaryExpression') current = current.left as Node
  return current
}

export default rule
