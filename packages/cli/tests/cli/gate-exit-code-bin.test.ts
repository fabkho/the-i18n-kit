import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const binPath = resolve(__dirname, '../../dist/bin.js')

/**
 * End-to-end proof that a gate produces a genuine process exit code (#248) —
 * the unit tests cover the decision, but only the real binary shows that
 * citty parses --fail-on-missing and that the code survives to the shell.
 * Requires a built dist (CI builds before testing).
 */
async function runBin(args: string[], cwd: string): Promise<{ stdout: string, code: number }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], { cwd })
    return { stdout, code: 0 }
  } catch (error) {
    const e = error as { stdout?: string, code?: number }
    return { stdout: e.stdout ?? '', code: e.code ?? 1 }
  }
}

describe('gate exit codes through the real binary', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-gate-exit-'))
    await mkdir(join(projectDir, 'locales'), { recursive: true })
    await writeFile(
      join(projectDir, '.i18n-mcp.json'),
      JSON.stringify({ defaultLocale: 'en', localeDirs: ['locales'], locales: ['en', 'de'] }),
    )
    // Keys are namespaced because the code scanner only treats dotted,
    // key-shaped candidates as references (#281).
    await writeFile(
      join(projectDir, 'locales/en.json'),
      JSON.stringify({ common: { greeting: 'Hello', farewell: 'Goodbye' } }),
    )
    // de is missing `common.farewell` — one missing key against the reference locale.
    await writeFile(
      join(projectDir, 'locales/de.json'),
      JSON.stringify({ common: { greeting: 'Hallo' } }),
    )
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('exits 2 and names the gate when --fail-on-missing finds missing keys', async () => {
    const { stdout, code } = await runBin(['missing', '--fail-on-missing'], projectDir)

    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({
      summary: { totalMissingKeys: 1 },
      gatesTripped: [{ name: 'fail-on-missing', observed: 1, threshold: 0 }],
    })
  })

  it('exits 0 on the same project without the gate flag', async () => {
    const { stdout, code } = await runBin(['missing'], projectDir)

    expect(code).toBe(0)
    const result = JSON.parse(stdout) as Record<string, unknown>
    expect(result.summary).toMatchObject({ totalMissingKeys: 1 })
    expect(result).not.toHaveProperty('gatesTripped')
  })

  it('exits 0 with the gate flag once nothing is missing', async () => {
    await writeFile(
      join(projectDir, 'locales/de.json'),
      JSON.stringify({ common: { greeting: 'Hallo', farewell: 'Tschüss' } }),
    )

    const { code } = await runBin(['missing', '--fail-on-missing'], projectDir)

    expect(code).toBe(0)
  })

  // orphans reports by default, so the gate trips without writing anything.
  it('exits 2 when --fail-on-orphans finds a key no source file references', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(join(projectDir, 'src/app.ts'), `export const label = t('common.greeting')\n`)

    const { stdout, code } = await runBin(['orphans', '--fail-on-orphans'], projectDir)

    expect(code).toBe(2)
    expect(JSON.parse(stdout)).toMatchObject({
      gatesTripped: [{ name: 'fail-on-orphans', counter: 'orphanCount', threshold: 0 }],
    })
  })

  it('exits 0 once every key is referenced', async () => {
    await writeFile(
      join(projectDir, 'src/app.ts'),
      `export const label = t('common.greeting')\nexport const bye = t('common.farewell')\n`,
    )

    const { code } = await runBin(['orphans', '--fail-on-orphans'], projectDir)

    expect(code).toBe(0)
  })

  // check's gate is always on — a key that renders raw in production is a
  // defect, not a threshold — but it is still a gate. Reporting it as exit 1
  // left CI unable to tell an undefined key from a scan that fell over (#369).
  describe('check, whose gate takes no flag', () => {
    it('exits 2 and names the gate when a key is defined nowhere', async () => {
      await writeFile(
        join(projectDir, 'src/app.ts'),
        `export const missing = t('common.nowhere')\n`,
      )

      const { stdout, code } = await runBin(['check'], projectDir)

      expect(code).toBe(2)
      expect(JSON.parse(stdout)).toMatchObject({
        summary: { undefinedCount: 1 },
        gatesTripped: [{ name: 'undefined-keys', counter: 'undefinedCount', threshold: 0, observed: 1 }],
      })
    })

    it('exits 0 when every referenced key is defined', async () => {
      await writeFile(
        join(projectDir, 'src/app.ts'),
        `export const label = t('common.greeting')\n`,
      )

      const { code } = await runBin(['check'], projectDir)

      expect(code).toBe(0)
    })

    it('still exits 1 when the run itself fails, so the two stay distinguishable', async () => {
      const { code } = await runBin(['check', '--projectDir', join(projectDir, 'no-such-dir')], projectDir)

      expect(code).toBe(1)
    })
  })
})
