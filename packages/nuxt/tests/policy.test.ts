import { describe, expect, it } from 'vitest'

import { conflictingPolicyKeys, readPolicy } from '../src/policy'
import { checkPolicyConflicts } from '../src/validate'

describe('reading policy off the module options', () => {
  it('takes the authoring keys', () => {
    const policy = readPolicy({
      context: 'a booking platform',
      glossary: { anny: 'never translate' },
      protectedLocales: ['de-formal'],
    })

    expect(policy).toEqual({
      context: 'a booking platform',
      glossary: { anny: 'never translate' },
      protectedLocales: ['de-formal'],
    })
  })

  // enabled and failOnInvalidConfig configure the module itself; publishing
  // them as project policy would put module plumbing in front of the agent.
  it('leaves the module knobs out', () => {
    expect(readPolicy({ enabled: true, failOnInvalidConfig: false })).toEqual({})
  })

  it('leaves out keys the module derives, so they cannot be smuggled back in', () => {
    expect(readPolicy({ locales: ['de'], defaultLocale: 'de', localeDirs: ['x'] })).toEqual({})
  })

  it('distinguishes an absent key from a falsy one', () => {
    const policy = readPolicy({ reportOutput: false, context: '' })

    expect(policy).toEqual({ reportOutput: false, context: '' })
  })
})

describe('the same key in both places', () => {
  it('is reported rather than resolved', () => {
    const conflicts = conflictingPolicyKeys(
      { glossary: { anny: 'x' }, context: 'from nuxt.config' },
      { context: 'from the json file', localeNotes: {} },
    )

    expect(conflicts).toEqual(['context'])
  })

  it('produces an error naming the key and both sources', () => {
    const [diagnostic, ...rest] = checkPolicyConflicts(
      { protectedLocales: ['de'] },
      { protectedLocales: ['en'] },
    )

    expect(rest).toEqual([])
    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain('"protectedLocales"')
    expect(diagnostic?.message).toContain('nuxt.config.ts')
    expect(diagnostic?.message).toContain('.i18n-mcp.json')
  })

  it('says nothing when the two sources describe different keys', () => {
    expect(checkPolicyConflicts({ glossary: {} }, { context: 'x' })).toEqual([])
  })

  it('says nothing when there is no file at all', () => {
    expect(checkPolicyConflicts({ glossary: {} }, null)).toEqual([])
  })
})
