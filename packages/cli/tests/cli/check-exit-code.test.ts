import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * CI exit-code gating for the `check` command (#195): undefined-key
 * findings must fail the build. Unit-tests the predicate (cf.
 * exit-code.test.ts for isTotalFailure) and the createCommand failWhen
 * mechanism that turns it into process.exitCode = 1.
 */

// writeResult bypasses stdout spies via a bound reference captured at module
// load — mock the guard so command output stays out of the test stream.
vi.mock('../../src/utils/stdout-guard.js', () => ({
  guardStdout: vi.fn(),
  writeResult: vi.fn(),
}))

const { hasUndefinedKeys } = await import('../../src/commands/check.js')
const { createCommand } = await import('../../src/commands/_shared.js')

describe('hasUndefinedKeys', () => {
  it('flags results with undefined-key findings', () => {
    expect(hasUndefinedKeys({
      undefinedKeys: [{ key: 'common.terms.none' }],
      summary: { undefinedCount: 1, uncertainCount: 0 },
    })).toBe(true)
  })

  it('accepts clean results, even with uncertain or ignored findings', () => {
    expect(hasUndefinedKeys({ undefinedKeys: [], summary: { undefinedCount: 0, uncertainCount: 3, ignoredCount: 2 } })).toBe(false)
  })

  it('works on the reportFile shape (summary only)', () => {
    expect(hasUndefinedKeys({ reportFile: '/tmp/r.json', summary: { undefinedCount: 2 } })).toBe(true)
    expect(hasUndefinedKeys({ reportFile: '/tmp/r.json', summary: { undefinedCount: 0 } })).toBe(false)
  })

  it('never flags malformed or unrelated results', () => {
    expect(hasUndefinedKeys(null)).toBe(false)
    expect(hasUndefinedKeys(undefined)).toBe(false)
    expect(hasUndefinedKeys('string')).toBe(false)
    expect(hasUndefinedKeys({})).toBe(false)
    expect(hasUndefinedKeys({ summary: 'text' })).toBe(false)
    expect(hasUndefinedKeys({ summary: { undefinedCount: '1' } })).toBe(false)
    expect(hasUndefinedKeys({ summary: { orphanCount: 5 } })).toBe(false)
  })
})

describe('createCommand failWhen gating', () => {
  const savedExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  const runFake = async (result: unknown): Promise<void> => {
    const cmd = createCommand({
      name: 'fake-check',
      description: 'test double',
      failWhen: hasUndefinedKeys,
      run: async () => result,
    }) as unknown as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
    await cmd.run({ args: { json: true } })
  }

  it('sets exitCode 1 when the check found undefined keys', async () => {
    await runFake({ undefinedKeys: [{ key: 'a.b' }], summary: { undefinedCount: 1 } })
    expect(process.exitCode).toBe(1)
  })

  it('leaves the exit code untouched on a clean result', async () => {
    await runFake({ undefinedKeys: [], summary: { undefinedCount: 0, uncertainCount: 1 } })
    expect(process.exitCode).toBe(savedExitCode)
  })
})
