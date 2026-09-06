import { describe, it, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RuleTester } from 'eslint'
import rule from '../src/rules/runtime-key-needs-declared-namespace.js'
import { resetDeclaredPatternsCacheForTests } from '../src/declared-patterns.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

// A real project dir, so config discovery and jiti loading are the real thing.
const project = join(tmpdir(), `i18n-eslint-rk-${process.pid}`)
const inProject = join(project, 'app', 'component.ts')

beforeAll(async () => {
  await rm(project, { recursive: true, force: true })
  await mkdir(join(project, 'app'), { recursive: true })
  await writeFile(join(project, 'i18n-kit.config.ts'), [
    `export default {`,
    `  declaredNamespaces: [`,
    `    { pattern: 'views.defaults.**', reason: 'sent by bookings-api as name_key' },`,
    `  ],`,
    `  orphanScan: {`,
    `    root: { ignorePatterns: ['common.errors.**'] },`,
    `  },`,
    `}`,
  ].join('\n'))
  resetDeclaredPatternsCacheForTests()
})

afterAll(async () => {
  await rm(project, { recursive: true, force: true })
})

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

const bound = (code: string) => `import { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\n${code}`

tester.run('runtime-key-needs-declared-namespace', rule, {
  valid: [
    // Not runtime data: literals, templates, concat — other machinery judges those.
    { code: bound(`t('common.actions.save')`), filename: inProject },
    { code: bound('t(`views.defaults.${x}`)'), filename: inProject },
    // The scanner's leniencies, restated: same-file const with a literal…
    { code: bound(`const key = 'a.b'\nt(key)`), filename: inProject },
    // …a const holding a dotted template (the unavailabilityReason.ts shape)…
    { code: bound('const key = `common.terms.unavailabilityTypes.${type}`\nt(key)'), filename: inProject },
    // …and a lookup into a same-file map of literal keys.
    { code: bound(`const LABELS = { a: 'x.a', b: 'x.b' }\nt(LABELS[state])`), filename: inProject },
    // Annotated with a namespace declaredNamespaces holds.
    {
      code: bound(`// i18n-namespace: views.defaults.**\nt(view.name_key)`),
      filename: inProject,
    },
    // A layer's ignorePatterns protect keys the same way, so they declare too.
    {
      code: bound(`// i18n-namespace: common.errors.**\nt(errorKeyFor(status))`),
      filename: inProject,
    },
    // Not an i18n call at all.
    { code: `client.t(item.labelKey)`, filename: inProject },
    // An existence check commits to nothing; only t() owes a declaration.
    { code: bound(`te(breadcrumb)`), filename: inProject },
    // A shadowed t is not an i18n call — nothing to declare.
    { code: bound(`function fmt(t) { return t(item.labelKey) }`), filename: inProject },
    { code: `$te(route.meta.breadcrumb)`, filename: inProject },
  ],
  invalid: [
    // The name_key incident, as the editor should have shown it.
    { code: bound(`t(view.name_key)`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    { code: bound(`t(props.labelKey)`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    { code: bound(`t(getErrorKey(code))`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    // Annotated, but the config never heard of it: drift, caught.
    {
      code: bound(`// i18n-namespace: emails.wire.**\nt(mail.subject_key)`),
      filename: inProject,
      errors: [{ messageId: 'notDeclared' }],
    },
    // A reassignable binding can hold anything by call time — not scanner-safe.
    { code: bound(`let key = 'a.b'\nkey = compute()\nt(key)`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    { code: bound(`let LABELS = { a: 'x.a' }\nLABELS = remote()\nt(LABELS[state])`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    // A conditional with one runtime branch is runtime.
    { code: bound(`t(ok ? 'a.b' : item.key)`), filename: inProject, errors: [{ messageId: 'undeclared' }] },
    // Annotated, but no kit config exists to hold the declaration.
    {
      code: bound(`// i18n-namespace: emails.wire.**\nt(mail.subject_key)`),
      filename: join(tmpdir(), 'no-config-anywhere.ts'),
      errors: [{ messageId: 'noConfig' }],
    },
  ],
})
