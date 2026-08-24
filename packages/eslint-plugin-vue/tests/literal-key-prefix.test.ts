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
    // A bare t with no vue-i18n in the file is not an i18n call.
    't(`${section}.title`)',
    // $t is unambiguous anywhere.
    '$t(`pages.${page}.title`)',
  ],
  invalid: [
    { code: bound('t(`${section}.title`)'), errors: [{ messageId: 'templatePrefix' }] },
    { code: bound('t(`${base}.${type}.label`)'), errors: [{ messageId: 'templatePrefix' }] },
    // A prefix without a dot bounds nothing.
    { code: bound('t(`x${rest}`)'), errors: [{ messageId: 'templatePrefix' }] },
    { code: bound(`t(prefix + '.title')`), errors: [{ messageId: 'concatPrefix' }] },
    { code: `this.$t(\`\${section}.title\`)`, errors: [{ messageId: 'templatePrefix' }] },
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
