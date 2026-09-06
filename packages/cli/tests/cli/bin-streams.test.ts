import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const binPath = resolve(__dirname, '../../dist/bin.js')
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

/**
 * Stream-level regression tests for the stdout guard: diagnostics must never
 * pollute stdout (CI pipes it into jq), while --help/--version stay on stdout
 * per CLI convention. Requires a built dist (CI builds before testing).
 */
async function runBin(args: string[], cwd?: string): Promise<{ stdout: string, stderr: string, code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binPath, ...args], { cwd })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const e = error as { stdout?: string, stderr?: string, code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('bin stream routing', () => {
  it('--help prints usage on stdout', async () => {
    const { stdout, code } = await runBin(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('USAGE')
  })

  it('subcommand --help prints usage on stdout', async () => {
    const { stdout, code } = await runBin(['translate', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('USAGE')
  })

  it('prints a subcommand\'s own flags, not just the shared ones', async () => {
    const { stdout, code } = await runBin(['translate', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--provider')
    expect(stdout).toContain('--batchSize')
  })

  it('--version prints the version on stdout', async () => {
    const { stdout, code } = await runBin(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toBe(version)
  })

  describe('guarded command output', () => {
    let emptyDir: string

    beforeAll(async () => {
      emptyDir = await mkdtemp(join(tmpdir(), 'i18n-bin-streams-'))
    })

    afterAll(async () => {
      await rm(emptyDir, { recursive: true, force: true })
    })

    // Failures must keep stdout parseable (#266): a JSON consumer piping
    // stdout into jq must never receive zero bytes.
    it('emits a structured JSON error on stdout when a command fails — diagnostics go to stderr', async () => {
      const { stdout, stderr, code } = await runBin(['missing', '--layer', 'root'], emptyDir)
      expect(code).toBe(1)
      expect(JSON.parse(stdout)).toMatchObject({
        error: {
          code: 'CONFIG_ERROR',
          message: expect.stringContaining('No framework detected'),
        },
      })
      expect(stderr).not.toBe('')
    })
  })
})
