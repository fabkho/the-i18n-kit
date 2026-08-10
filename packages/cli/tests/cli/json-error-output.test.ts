import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * JSON-mode failure output (#266): when a command run throws, stdout must
 * still carry parseable JSON — consumers pipe it into jq, and zero bytes is
 * a parse error. The structured `{ error: { code, message } }` object is the
 * result; the exit code stays non-zero.
 */

// writeResult bypasses stdout spies via a bound reference captured at module
// load — mock the guard so command output stays out of the test stream.
vi.mock('../../src/utils/stdout-guard.js', () => ({
  guardStdout: vi.fn(),
  writeResult: vi.fn(),
}))

const { writeResult } = await import('../../src/utils/stdout-guard.js')
const { createCommand, emitErrorResult } = await import('../../src/commands/_shared.js')
const { ToolError } = await import('../../src/utils/errors.js')

const writeResultMock = vi.mocked(writeResult)

const savedExitCode = process.exitCode

afterEach(() => {
  process.exitCode = savedExitCode
  writeResultMock.mockClear()
})

function lastStdoutJson(): unknown {
  const calls = writeResultMock.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return JSON.parse(calls[calls.length - 1]![0])
}

describe('createCommand error path', () => {
  const runFailing = async (error: unknown): Promise<void> => {
    const cmd = createCommand({
      name: 'fake-fail',
      description: 'test double',
      run: async () => {
        throw error
      },
    }) as unknown as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
    await cmd.run({ args: { json: true } })
  }

  it('emits a structured error object on stdout and sets exitCode 1', async () => {
    await runFailing(new ToolError('report path escapes the project dir', 'INVALID_REPORT_PATH'))

    expect(lastStdoutJson()).toEqual({
      error: {
        code: 'INVALID_REPORT_PATH',
        message: 'report path escapes the project dir',
      },
    })
    expect(process.exitCode).toBe(1)
  })

  it('falls back to UNKNOWN_ERROR for errors without a code', async () => {
    await runFailing(new Error('boom'))

    expect(lastStdoutJson()).toEqual({
      error: { code: 'UNKNOWN_ERROR', message: 'boom' },
    })
    expect(process.exitCode).toBe(1)
  })
})

describe('emitErrorResult mode gating', () => {
  it('emits JSON when stdout is not a TTY even without --json', () => {
    // Vitest pipes stdout, so isTTY is falsy — matches outputResult's gating.
    emitErrorResult(new ToolError('nope', 'CODE_X'), { json: false })
    expect(lastStdoutJson()).toEqual({ error: { code: 'CODE_X', message: 'nope' } })
  })

  it('keeps stdout untouched in interactive non-JSON mode', () => {
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      emitErrorResult(new Error('boom'), { json: false })
      expect(writeResultMock).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(process.stdout, 'isTTY', original)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  })
})
