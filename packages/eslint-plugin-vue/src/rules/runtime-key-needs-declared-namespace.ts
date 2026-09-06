import type { Rule } from 'eslint'
import type { CallExpression, Expression, Node } from 'estree'
import { callVisitor, firstArgument, isI18nCall } from '../i18n-calls.js'
import { declaredPatterns, findKitConfig } from '../declared-patterns.js'

/**
 * An i18n call whose key is entirely runtime data must be tied to a declared
 * namespace.
 *
 * `t(view.name_key)` keeps alive whichever keys the wire sends — the scanner
 * sees nothing, the keys look orphaned, and remove-orphans deletes them. The
 * rule demands two things, both checkable: an `i18n-namespace:` comment at the
 * call naming the namespace it draws from, and that namespace declared in the
 * kit config, where the scanner actually reads it. Annotation without
 * declaration is config drift; declaration without annotation is a call the
 * next reader cannot connect to it — the orphan report names the second by
 * listing every declaration with the keys it matches.
 *
 * What does NOT fire, mirroring the scanner's own leniency: string literals,
 * templates (rule literal-key-prefix's turf), same-file consts holding
 * literals or dotted templates, and lookups into same-file maps of literal
 * keys — the candidate net already protects all of those.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'i18n keys from runtime data must name a namespace declared in the kit config, so the orphan scanner is never blind and undeclared at once',
      url: 'https://github.com/fabkho/the-i18n-kit/issues/422',
    },
    messages: {
      undeclared: 'This key exists only at runtime — the orphan scanner cannot see which keys it uses, so they will be reported as deletable. Name the namespace it draws from with a comment on this line, e.g. `// i18n-namespace: some.namespace.**`, and declare that pattern under declaredNamespaces in i18n-kit.config.ts.',
      notDeclared: 'The annotated namespace `{{pattern}}` is not declared in the kit config. Add it under declaredNamespaces in {{configPath}}, with the reason these keys exist — the annotation only protects keys if the orphan scanner reads the same declaration.',
      noConfig: 'This key exists only at runtime and no i18n-kit config was found to declare its namespace in. The orphan scanner will report the keys it uses as deletable.',
    },
    schema: [],
  },

  create(context) {
    return callVisitor(context, (node) => {
      if (!isI18nCall(node, context)) return
      // Existence checks (`te`) commit to nothing — only the translating call
      // keeps keys alive, so only it owes a declaration. Two errors on
      // `te(x) ? t(x) : x` would be one too many.
      if (isExistenceCheck(node)) return
      const arg = firstArgument(node)
      if (!arg || !isRuntimeData(arg as Expression, context)) return

      const annotation = namespaceAnnotation(node, context)
      const configPath = findKitConfig(context.filename)

      if (!annotation) {
        context.report({ node: arg as Node & Rule.NodeParentExtension, messageId: 'undeclared' })
        return
      }
      if (!configPath) {
        context.report({ node: arg as Node & Rule.NodeParentExtension, messageId: 'noConfig' })
        return
      }
      if (!declaredPatterns(configPath).has(annotation)) {
        context.report({
          node: arg as Node & Rule.NodeParentExtension,
          messageId: 'notDeclared',
          data: { pattern: annotation, configPath },
        })
      }
    })
  },
}

function isExistenceCheck(node: CallExpression): boolean {
  const callee = node.callee
  const name = callee.type === 'Identifier'
    ? callee.name
    : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
      ? callee.property.name
      : ''
  return name === 'te' || name === '$te'
}

/** `// i18n-namespace: views.defaults.**` on the call's line or the line above. */
function namespaceAnnotation(node: CallExpression, context: Rule.RuleContext): string | undefined {
  const line = node.loc?.start.line
  if (!line) return undefined
  for (const comment of context.sourceCode.getAllComments()) {
    const commentLine = comment.loc?.start.line
    if (commentLine !== line && commentLine !== line - 1) continue
    const match = /i18n-namespace:\s*(\S+)/.exec(comment.value)
    if (match?.[1]) return match[1]
  }
  return undefined
}

/**
 * Runtime data is anything the scanner could not read a key or bound from.
 * The leniencies below are the scanner's, restated: what the candidate net
 * protects, the rule does not question.
 */
function isRuntimeData(arg: Expression, context: Rule.RuleContext): boolean {
  // Literals, templates and concatenation are readable (literal-key-prefix
  // judges the built ones); a conditional is runtime if either branch is.
  if (STATIC_SHAPES.has(arg.type)) return false
  if (arg.type === 'ConditionalExpression') {
    return isRuntimeData(arg.consequent as Expression, context)
      || isRuntimeData(arg.alternate as Expression, context)
  }
  if (arg.type === 'Identifier') return !resolvesToLiteralish(arg, context)
  if (arg.type === 'MemberExpression') return !isLiteralMapLookup(arg, context)
  return true
}

const STATIC_SHAPES = new Set(['Literal', 'TemplateLiteral', 'BinaryExpression'])

/** LABELS[state] with a same-file map of literals is net-protected. */
function isLiteralMapLookup(arg: Expression & { type: 'MemberExpression' }, context: Rule.RuleContext): boolean {
  return arg.computed
    && arg.object.type === 'Identifier'
    && resolvesToLiteralMap(arg.object, context)
}

/** A same-file const holding a string literal or a dotted-prefix template. */
function resolvesToLiteralish(id: Node & { name: string }, context: Rule.RuleContext): boolean {
  const init = constInitializer(id, context)
  if (!init) return false
  if (init.type === 'Literal' && typeof init.value === 'string') return true
  if (init.type === 'TemplateLiteral') {
    return (init.quasis[0]?.value.cooked ?? '').includes('.')
  }
  return false
}

/** A same-file object literal whose values are all string literals. */
function resolvesToLiteralMap(id: Node & { name: string }, context: Rule.RuleContext): boolean {
  const init = constInitializer(id, context)
  if (init?.type !== 'ObjectExpression') return false
  return init.properties.every(prop =>
    prop.type === 'Property'
    && prop.value.type === 'Literal'
    && typeof prop.value.value === 'string')
}

function constInitializer(id: Node & { name: string }, context: Rule.RuleContext): Expression | undefined {
  const scope = context.sourceCode.getScope(id)
  let current: typeof scope | null = scope
  while (current) {
    const variable = current.variables.find(v => v.name === id.name)
    if (variable) {
      const def = variable.defs[0]
      // Only an immutable binding is scanner-safe: a reassigned `let` can
      // hold anything by the time the call runs.
      if (
        def?.node.type === 'VariableDeclarator'
        && def.node.init
        && (def.parent as { kind?: string } | undefined)?.kind === 'const'
      ) {
        return def.node.init as Expression
      }
      return undefined
    }
    current = current.upper
  }
  return undefined
}

export default rule
