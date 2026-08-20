import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * CI exit-code gating for the `check` command (#195, #369): undefined-key
 * findings must fail the build, and they must fail it as a *gate* — exit 2,
 * with the finding named — so a caller can tell an undefined key from a scan
 * that fell over. Both used to be exit 1.
 */

// writeResult bypasses stdout spies via a bound reference captured at module
// load — mock the guard so command output stays out of the test stream.
vi.mock('../../src/utils/stdout-guard.js', () => ({
  guardStdout: vi.fn(),
  writeResult: vi.fn(),
}))

const { default: checkCommand } = await import('../../src/commands/check.js')
const { createCommand } = await import('../../src/commands/_shared.js')

describe('the check command definition', () => {
  it('declares its gate on the definition, so the reference can state it', () => {
    expect((checkCommand as unknown as { gates: unknown }).gates).toEqual([
      { name: 'undefined-keys', counter: 'undefinedCount', threshold: 0 },
    ])
  })

  it('has no flag for the gate — a key that renders raw is not opt-in', () => {
    expect(Object.keys((checkCommand as unknown as { args: object }).args))
      .not.toContain('failOnUndefined')
  })
})

describe('gating on undefined-key findings', () => {
  const savedExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = savedExitCode
  })

  /** A stand-in for `check` carrying the same gate, run against a fixed result. */
  const runFake = async (result: unknown): Promise<void> => {
    const cmd = createCommand({
      name: 'fake-check',
      description: 'test double',
      gates: [{ name: 'undefined-keys', counter: 'undefinedCount', threshold: 0 }],
      run: async () => result,
    }) as unknown as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
    await cmd.run({ args: { json: true } })
  }

  it('exits 2 when the check found undefined keys', async () => {
    await runFake({ undefinedKeys: [{ key: 'a.b' }], summary: { undefinedCount: 1 } })

    expect(process.exitCode).toBe(2)
  })

  it('trips on the reportFile shape too, where only the summary is present', async () => {
    await runFake({ reportFile: '/tmp/r.json', summary: { undefinedCount: 2 } })

    expect(process.exitCode).toBe(2)
  })

  // Uncertain findings are the ones the scanner could not resolve, not keys
  // known to be undefined — failing a build on them would punish dynamic keys.
  it('leaves the exit code untouched on a clean result, uncertain findings and all', async () => {
    await runFake({ undefinedKeys: [], summary: { undefinedCount: 0, uncertainCount: 3, ignoredCount: 2 } })

    expect(process.exitCode).toBe(savedExitCode)
  })

  it('never trips on a malformed or unrelated result', async () => {
    for (const result of [null, 'string', {}, { summary: 'text' }, { summary: { undefinedCount: '1' } }, { summary: { orphanCount: 5 } }]) {
      process.exitCode = savedExitCode
      await runFake(result)
      expect(process.exitCode).toBe(savedExitCode)
    }
  })
})
