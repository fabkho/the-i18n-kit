import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * Wiring tests for the opt-in CI gates (#248): the command factory reads the
 * requesting flag off args, evaluates the gates the command declared, and
 * reports the tripped ones in the result. The decision itself is unit-tested
 * in exit-code.test.ts; this file covers the seam between flags and factory.
 */

// writeResult bypasses stdout spies via a bound reference captured at module
// load — mock the guard so command output stays out of the test stream, and
// so the emitted result can be inspected.
vi.mock('../../src/utils/stdout-guard.js', () => ({
  guardStdout: vi.fn(),
  writeResult: vi.fn(),
}))

const { writeResult } = await import('../../src/utils/stdout-guard.js')
const { createCommand } = await import('../../src/commands/_shared.js')

const missingGate = { flag: 'failOnMissing', counter: 'totalMissingKeys', threshold: 0 }
const orphanGate = { flag: 'failOnOrphans', counter: 'orphanCount', threshold: 0 }

const savedExitCode = process.exitCode

beforeEach(() => {
  vi.mocked(writeResult).mockClear()
})

afterEach(() => {
  process.exitCode = savedExitCode
})

/** Run a command double and return what it wrote to stdout. */
async function runFake(
  opts: { gates?: typeof missingGate[], failWhen?: (r: unknown) => boolean, result: unknown },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cmd = createCommand({
    name: 'fake',
    description: 'test double',
    gates: opts.gates,
    failWhen: opts.failWhen,
    run: async () => opts.result,
  }) as unknown as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }

  await cmd.run({ args: { json: true, ...args } })

  const written = vi.mocked(writeResult).mock.calls.at(-1)?.[0] ?? 'null'
  return JSON.parse(written) as Record<string, unknown>
}

describe('gate flags', () => {
  it('exits 2 and names the tripped gate when the flag is set', async () => {
    const output = await runFake(
      { gates: [missingGate], result: { summary: { totalMissingKeys: 12 } } },
      { failOnMissing: true },
    )

    expect(process.exitCode).toBe(2)
    expect(output.gatesTripped).toEqual([
      { name: 'fail-on-missing', counter: 'totalMissingKeys', direction: 'above', threshold: 0, observed: 12 },
    ])
  })

  it('leaves the exit code and the result shape alone when the flag is absent', async () => {
    const output = await runFake(
      { gates: [missingGate], result: { missing: { de: ['a.b'] }, summary: { totalMissingKeys: 12 } } },
      {},
    )

    expect(process.exitCode).toBe(savedExitCode)
    expect(output).toEqual({ missing: { de: ['a.b'] }, summary: { totalMissingKeys: 12 } })
  })

  it('does not trip when the flag is set but there is nothing to find', async () => {
    const output = await runFake(
      { gates: [missingGate], result: { summary: { totalMissingKeys: 0 } } },
      { failOnMissing: true },
    )

    expect(process.exitCode).toBe(savedExitCode)
    expect(output).not.toHaveProperty('gatesTripped')
  })

  it('composes several gates on one invocation', async () => {
    const output = await runFake(
      {
        gates: [missingGate, orphanGate],
        result: { summary: { totalMissingKeys: 4, orphanCount: 7 } },
      },
      { failOnMissing: true, failOnOrphans: true },
    )

    expect(process.exitCode).toBe(2)
    expect(output.gatesTripped).toHaveLength(2)
  })

  it('evaluates only the gates whose flags were passed', async () => {
    const output = await runFake(
      {
        gates: [missingGate, orphanGate],
        result: { summary: { totalMissingKeys: 4, orphanCount: 7 } },
      },
      { failOnOrphans: true },
    )

    expect((output.gatesTripped as Array<{ name: string }>).map(g => g.name))
      .toEqual(['fail-on-orphans'])
  })

  // A gate says "the project has findings"; failWhen and isTotalFailure say
  // "the run fell over". CI must be able to tell those apart.
  it('reports a failed run as exit 1 even when a gate would also trip', async () => {
    const output = await runFake(
      {
        gates: [missingGate],
        failWhen: () => true,
        result: { summary: { totalMissingKeys: 12 } },
      },
      { failOnMissing: true },
    )

    expect(process.exitCode).toBe(1)
    expect(output).not.toHaveProperty('gatesTripped')
  })

  it('keeps exit 1 for a total translate failure, with no gates declared', async () => {
    await runFake(
      { result: { summary: { totalTranslated: 0, totalFailed: 4 } } },
      {},
    )

    expect(process.exitCode).toBe(1)
  })
})
