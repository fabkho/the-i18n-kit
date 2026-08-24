import type { Rule } from 'eslint'
import type { CallExpression, Node } from 'estree'

/**
 * What counts as an i18n call, mirrored from the scanner's recognition
 * (the-i18n-cli, scanner rules): `$t`/`$te`/`$tc` anywhere, and a bare `t`
 * only where the file shows a vue-i18n binding. Lint and scan must never
 * disagree about what a call is — a rule firing on `client.t(...)` would
 * teach people to ignore it.
 *
 * Vue-only by decision (#422): the React call families are not recognised.
 */

const ALWAYS_I18N = new Set(['$t', '$te', '$tc'])
const BARE_NAMES = new Set(['t', 'te', 'tc'])

/** `const { t } = useI18n()` or an i18n import somewhere in the file. */
function fileBindsVueI18n(context: Rule.RuleContext): boolean {
  const text = context.sourceCode.text
  return text.includes('useI18n(') || text.includes('vue-i18n') || text.includes('@nuxtjs/i18n')
}

export function isI18nCall(node: CallExpression, context: Rule.RuleContext): boolean {
  const callee = node.callee
  if (callee.type === 'Identifier') {
    if (ALWAYS_I18N.has(callee.name)) return true
    return BARE_NAMES.has(callee.name) && fileBindsVueI18n(context)
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const name = callee.property.name
    // this.$t / vm.$t / nuxtApp.$i18n.t — the $-names are unambiguous on any
    // receiver; a plain `.t` is only i18n on an $i18n-ish receiver.
    if (ALWAYS_I18N.has(name)) return true
    if (BARE_NAMES.has(name)) {
      const object = callee.object
      return object.type === 'MemberExpression'
        && !object.computed
        && object.property.type === 'Identifier'
        && object.property.name === '$i18n'
    }
  }
  return false
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
