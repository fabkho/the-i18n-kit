import { describe, it, expect } from 'vitest'
import { RuleTester } from 'eslint'
import rule from '../src/rules/literal-key-prefix.js'

// RuleTester needs a test frame; vitest provides it.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

const bound = (code: string) => `import { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\n${code}`

tester.run('literal-key-prefix', rule, {
  valid: [
    // Static keys are not "built".
    bound(`t('common.actions.save')`),
    // A literal dotted prefix bounds what the call can produce.
    bound('t(`bookings.status.${status}`)'),
    bound(`t('bookings.status.' + status)`),
    // Slotless backticks are plain strings.
    bound('t(`common.save`)'),
    // Runtime data is the other rule's turf.
    bound(`t(item.labelKey)`),
    // A same-file const prefix resolves to exact keys — the #284 fix, which
    // the scanner protects and the rule therefore accepts.
    bound("const i18nBase = 'pages.settings.widget'\nt(`${i18nBase}.title`)"),
    // A slotless backtick is a literal in every sense, concat included.
    bound('t(`components.actions.` + action)'),
    // A bare t with no vue-i18n in the file is not an i18n call.
    't(`${section}.title`)',
    // A shadowed t is whatever shadows it, however many useI18n calls exist.
    bound('function fmt(t) { return t(`${section}.title`) }'),
    // $t is unambiguous anywhere.
    '$t(`pages.${page}.title`)',
  ],
  invalid: [
    { code: bound('t(`${section}.title`)'), errors: [{ messageId: 'templatePrefix' }] },
    { code: bound('t(`${base}.${type}.label`)'), errors: [{ messageId: 'templatePrefix' }] },
    // A cross-file prefix resolves to nothing the scanner can bound.
    { code: bound('t(`${config.translationPrefix}.totalRevenue`)'), errors: [{ messageId: 'templatePrefix' }] },
    // A dotless const bounds nothing either.
    { code: bound("const word = 'title'\nt(`${word}.${x}`)"), errors: [{ messageId: 'templatePrefix' }] },
    // A reassignable binding is not a prefix.
    { code: bound("let base = 'a.b'\nt(`${base}.title`)"), errors: [{ messageId: 'templatePrefix' }] },
    // A prefix without a dot bounds nothing.
    { code: bound('t(`x${rest}`)'), errors: [{ messageId: 'templatePrefix' }] },
    { code: bound(`t(prefix + '.title')`), errors: [{ messageId: 'concatPrefix' }] },
    { code: `this.$t(\`\${section}.title\`)`, errors: [{ messageId: 'templatePrefix' }] },
    // composer.t resolves through the useI18n() instance.
    {
      code: `import { useI18n } from 'vue-i18n'\nconst composer = useI18n()\ncomposer.t(\`\${section}.title\`)`,
      errors: [{ messageId: 'templatePrefix' }],
    },
  ],
})

describe('inside a Vue template', () => {
  it('judges template expressions like script code', async () => {
    const { Linter } = await import('eslint')
    const vueParser = await import('vue-eslint-parser')
    const linter = new Linter()
    const messages = linter.verify(
      `<template><p>{{ $t(\`\${section}.title\`) }}</p></template>`,
      {
        files: ['**/*.vue'],
        languageOptions: { parser: vueParser as never },
        plugins: { kit: { rules: { r: rule } } },
        rules: { 'kit/r': 'error' },
      },
      'A.vue',
    )
    expect(messages.map(m => m.messageId)).toEqual(['templatePrefix'])
  })
})
