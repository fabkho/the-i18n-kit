import type { Rule } from 'eslint'
import type { Node } from 'estree'
import { callVisitor, firstArgument, isI18nCall } from '../i18n-calls.js'

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
      const messageId = builtKeyProblem(arg)
      if (messageId) {
        context.report({ node: arg as Node & Rule.NodeParentExtension, messageId, data: { example: '${rest}' } })
      }
    })
  },
}

/** The messageId a built key earns, or undefined for anything acceptable. */
function builtKeyProblem(arg: Node): 'templatePrefix' | 'concatPrefix' | undefined {
  if (arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
    return dotted(arg.quasis[0]?.value.cooked) ? undefined : 'templatePrefix'
  }
  if (arg.type === 'BinaryExpression' && arg.operator === '+') {
    return dotted(literalValue(leftmostOperand(arg))) ? undefined : 'concatPrefix'
  }
  return undefined
}

const dotted = (text: string | null | undefined): boolean => text?.includes('.') ?? false

const literalValue = (node: Node): string | undefined =>
  node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined

function leftmostOperand(node: Node): Node {
  let current: Node = node
  while (current.type === 'BinaryExpression') current = current.left as Node
  return current
}

export default rule
