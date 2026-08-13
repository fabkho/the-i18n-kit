import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '../../../..')
const binPath = resolve(import.meta.dirname, '../../dist/bin.js')

/**
 * Behavioural tests for the shipped CI templates (#254): the job scripts are
 * extracted from the real YAML and executed against the real CLI, so the
 * exit-code contract is verified by running it rather than by grepping the
 * template. Requires a built dist (CI builds before testing).
 *
 * A `the-i18n-cli` shim on PATH stands in for the globally installed CLI that
 * the templates' before_script would provide.
 */

interface Run { stdout: string, stderr: string, code: number }

/**
 * GitLab job scripts run under busybox sh in the default alpine image, so they
 * are exercised with a POSIX shell — running them under bash would hide
 * bash-isms the runner would reject. `dash` is preferred where present because
 * macOS `/bin/sh` is bash in POSIX mode and still accepts constructs a real
 * POSIX shell rejects (`set -o pipefail` among them), which would let a
 * portability regression pass locally and fail on CI. The action's steps
 * declare `shell: bash` and use bash arrays, so those are exercised with bash.
 */
const posixShell = existsSync('/bin/dash') ? '/bin/dash' : 'sh'
async function runScript(
  script: string,
  cwd: string,
  env: Record<string, string>,
  binDir: string,
  shell: string = posixShell,
): Promise<Run> {
  const scriptPath = join(cwd, '.job.sh')
  await writeFile(scriptPath, script)
  try {
    const { stdout, stderr } = await execFileAsync(shell, [scriptPath], {
      cwd,
      env: { ...process.env, ...env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const e = error as { stdout?: string, stderr?: string, code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

async function jobScript(name: string): Promise<string> {
  const raw = await readFile(join(repoRoot, 'gitlab-ci.yml'), 'utf-8')
  const doc = parse(raw) as Record<string, { script: string[] }>
  const job = doc[name]
  if (!job) throw new Error(`job ${name} not found in gitlab-ci.yml`)
  return job.script.join('\n')
}

describe('gitlab-ci.yml job scripts, executed', () => {
  let projectDir: string
  let binDir: string

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-tpl-exec-'))

    // Shim standing in for the globally installed CLI.
    binDir = join(projectDir, '.bin')
    await mkdir(binDir, { recursive: true })
    const shim = join(binDir, 'the-i18n-cli')
    await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${binPath}" "$@"\n`)
    await chmod(shim, 0o755)

    await mkdir(join(projectDir, 'locales'), { recursive: true })
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(
      join(projectDir, '.i18n-mcp.json'),
      JSON.stringify({ defaultLocale: 'en', localeDirs: ['locales'], locales: ['en'] }),
    )
    await writeFile(
      join(projectDir, 'locales/en.json'),
      JSON.stringify({ common: { greeting: 'Hello', farewell: 'Goodbye' } }),
    )
    // Only common.greeting is referenced, so common.farewell is an orphan.
    await writeFile(join(projectDir, 'src/app.ts'), `export const a = t('common.greeting')\n`)
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  const cleanupEnv = (failOnOrphans: string) => ({
    I18N_LAYER: '',
    I18N_FAIL_ON_ORPHANS: failOnOrphans,
    CI_JOB_URL: 'https://example.test/job/1',
  })

  describe('.i18n-cleanup', () => {
    it('exits 0 on findings when the gate is not requested', async () => {
      const run = await runScript(await jobScript('.i18n-cleanup'), projectDir, cleanupEnv('false'), binDir)

      expect(run.code).toBe(0)
      // The findings are still reported — the gate governs the outcome, not the report.
      expect(run.stdout).toContain('Orphan keys found: 1')
    })

    it('exits 2 on findings when I18N_FAIL_ON_ORPHANS is true', async () => {
      const run = await runScript(await jobScript('.i18n-cleanup'), projectDir, cleanupEnv('true'), binDir)

      expect(run.code).toBe(2)
      expect(run.stdout).toContain('Orphan keys found: 1')
    })

    it('still writes the Code Quality artifact when the gate trips', async () => {
      await runScript(await jobScript('.i18n-cleanup'), projectDir, cleanupEnv('true'), binDir)

      const report = JSON.parse(await readFile(join(projectDir, 'gl-codequality.json'), 'utf-8'))
      expect(Array.isArray(report)).toBe(true)
      expect(report.length).toBeGreaterThan(0)
    })

    // Exit 1 and exit 2 must not look alike: allow_failure.exit_codes: [2]
    // only tells warnings from failures if a broken run exits something else.
    it('exits 1, not 2, when the scan itself fails', async () => {
      const brokenDir = await mkdtemp(join(tmpdir(), 'i18n-tpl-broken-'))
      const run = await runScript(await jobScript('.i18n-cleanup'), brokenDir, cleanupEnv('true'), binDir)

      expect(run.code).toBe(1)
      expect(run.stdout).toContain('orphan scan failed (exit 1)')
      await rm(brokenDir, { recursive: true, force: true })
    })
  })

  /**
   * The translate job needs a real provider, so its CLI call is stubbed. Its
   * STATUS branching is the part under test, and I18N_DRY_RUN keeps the run
   * short of the git and push stages that follow it.
   */
  describe('.i18n-translate STATUS branching', () => {
    async function runTranslate(stubResult: string, stubExit: number): Promise<Run> {
      const dir = await mkdtemp(join(tmpdir(), 'i18n-tpl-translate-'))
      const stubBin = join(dir, '.bin')
      await mkdir(stubBin, { recursive: true })
      const shim = join(stubBin, 'the-i18n-cli')
      await writeFile(shim, `#!/bin/sh\ncat <<'JSON'\n${stubResult}\nJSON\nexit ${stubExit}\n`)
      await chmod(shim, 0o755)

      const run = await runScript(await jobScript('.i18n-translate'), dir, {
        I18N_PROVIDER: 'openai',
        I18N_MODEL: 'stub-model',
        I18N_API_KEY: 'stub',
        I18N_LAYER: '',
        I18N_LOCALES: '',
        I18N_SOURCE_LOCALE: '',
        I18N_KEYS: '',
        I18N_BATCH_SIZE: '50',
        I18N_DRY_RUN: 'true',
      }, stubBin)

      await rm(dir, { recursive: true, force: true })
      return run
    }

    it('exits 0 on a successful run', async () => {
      const run = await runTranslate(JSON.stringify({ summary: { totalTranslated: 3, totalFailed: 0 } }), 0)

      expect(run.code).toBe(0)
      expect(run.stdout).toContain('Translated: 3, failed: 0')
    })

    it('exits 1 and explains the failure when the run itself failed', async () => {
      const run = await runTranslate(JSON.stringify({ error: { code: 'CONFIG_ERROR', message: 'nope' } }), 1)

      expect(run.code).toBe(1)
      expect(run.stdout).toContain('translate failed (exit 1)')
    })

    it('exits 2 and names the gate, distinctly from a failure', async () => {
      const run = await runTranslate(JSON.stringify({
        summary: { totalTranslated: 5, totalFailed: 0 },
        gatesTripped: [{ name: 'fail-on-missing', observed: 12, threshold: 0 }],
      }), 2)

      expect(run.code).toBe(2)
      expect(run.stdout).toContain('GATE: fail-on-missing tripped')
      expect(run.stdout).not.toContain('translate failed')
    })

    it('trusts the exit code over the counts when they disagree', async () => {
      const failLooking = JSON.stringify({ summary: { totalTranslated: 0, totalFailed: 9 } })

      expect((await runTranslate(failLooking, 0)).code).toBe(0)
    })
  })

})

/**
 * The action's translate step needs a real provider, so it cannot be driven
 * end-to-end here. Its exit-code branching can be: a stub CLI returns a chosen
 * result and exit code, and the step must react to the code rather than to the
 * counts in the payload — including when the two disagree.
 */
describe('action.yml translate step, executed against a stub CLI', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'i18n-action-exec-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function translateStepScript(): Promise<string> {
    const raw = await readFile(join(repoRoot, 'action.yml'), 'utf-8')
    const doc = parse(raw) as { runs: { steps: Array<{ id?: string, run?: string }> } }
    const step = doc.runs.steps.find(s => s.id === 'translate')
    if (!step?.run) throw new Error('translate step not found in action.yml')

    // Composite-action expressions are resolved by the runner, not by bash.
    return step.run
      .replace(/\$\{\{\s*inputs\.dry_run\s*\}\}/g, 'false')
      .replace(/\$\{\{\s*inputs\.(locales|source_locale|keys)\s*\}\}/g, '')
      .replace(/\$\{\{\s*inputs\.\w+\s*\}\}/g, 'stub')
  }

  async function runStep(stubResult: string, stubExit: number): Promise<Run & { outputs: string }> {
    const dir = await mkdtemp(join(workDir, 'case-'))
    const binDir = join(dir, '.bin')
    await mkdir(binDir, { recursive: true })
    const shim = join(binDir, 'the-i18n-cli')
    await writeFile(shim, `#!/bin/sh\ncat <<'JSON'\n${stubResult}\nJSON\nexit ${stubExit}\n`)
    await chmod(shim, 0o755)

    const outputFile = join(dir, 'github_output')
    await writeFile(outputFile, '')

    const run = await runScript(await translateStepScript(), dir, {
      I18N_PROVIDER: 'openai',
      I18N_API_KEY: 'stub',
      GITHUB_OUTPUT: outputFile,
    }, binDir, 'bash')

    return { ...run, outputs: await readFile(outputFile, 'utf-8') }
  }

  it('succeeds when the CLI exits 0', async () => {
    const run = await runStep(JSON.stringify({ summary: { totalTranslated: 3, totalFailed: 0 } }), 0)

    expect(run.code).toBe(0)
    expect(run.outputs).toContain('translated_count=3')
    expect(run.outputs).toContain('failed_count=0')
  })

  it('propagates exit 1 as a run failure', async () => {
    const run = await runStep(JSON.stringify({ error: { code: 'CONFIG_ERROR', message: 'nope' } }), 1)

    expect(run.code).toBe(1)
    expect(run.stdout).toContain('translate failed (exit 1)')
  })

  it('propagates exit 2 as a gate, named and distinct from a failure', async () => {
    const run = await runStep(JSON.stringify({
      summary: { totalTranslated: 5, totalFailed: 0 },
      gatesTripped: [{ name: 'fail-on-missing', observed: 12, threshold: 0 }],
    }), 2)

    expect(run.code).toBe(2)
    expect(run.stdout).toContain('CI gate tripped: fail-on-missing')
    expect(run.stdout).not.toContain('translate failed')
  })

  // The old implementation decided from these counts, so a payload whose
  // counts and exit code disagree is exactly what would regress.
  it('trusts the exit code over the counts when they disagree', async () => {
    const failLooking = JSON.stringify({ summary: { totalTranslated: 0, totalFailed: 9 } })

    expect((await runStep(failLooking, 0)).code).toBe(0)
    expect((await runStep(JSON.stringify({ summary: { totalTranslated: 9, totalFailed: 0 } }), 1)).code).toBe(1)
  })

  it('still emits counts for the step outputs when the run failed', async () => {
    const run = await runStep(JSON.stringify({ summary: { totalTranslated: 0, totalFailed: 4 } }), 1)

    expect(run.outputs).toContain('failed_count=4')
  })
})

describe('gitlab-ci.yml gate configuration', () => {
  it('allows exit 2 only, so a broken scan still fails the cleanup job red', async () => {
    const raw = await readFile(join(repoRoot, 'gitlab-ci.yml'), 'utf-8')
    const doc = parse(raw) as Record<string, { allow_failure?: unknown }>

    expect(doc['.i18n-cleanup'].allow_failure).toEqual({ exit_codes: [2] })
  })

  it('declares the orphan gate as an opt-in variable defaulting to off', async () => {
    const raw = await readFile(join(repoRoot, 'gitlab-ci.yml'), 'utf-8')
    const doc = parse(raw) as Record<string, { variables: Record<string, string> }>

    expect(doc['.i18n-cleanup'].variables.I18N_FAIL_ON_ORPHANS).toBe('false')
  })

  it('never decides an outcome from a parsed count', async () => {
    // Both shipped templates, so the regression cannot come back through
    // whichever one is not under active edit.
    const gitlabRaw = await readFile(join(repoRoot, 'gitlab-ci.yml'), 'utf-8')
    const gitlabDoc = parse(gitlabRaw) as Record<string, { script?: string[] }>

    const actionRaw = await readFile(join(repoRoot, 'action.yml'), 'utf-8')
    const actionDoc = parse(actionRaw) as { runs: { steps: Array<{ name?: string, id?: string, run?: string }> } }

    const scripts: Array<[string, string]> = [
      ...Object.entries(gitlabDoc)
        .filter(([, job]) => job?.script)
        .map(([name, job]) => [`gitlab-ci.yml ${name}`, job.script!.join('\n')] as [string, string]),
      ...actionDoc.runs.steps
        .filter(step => step.run)
        .map(step => [`action.yml ${step.id ?? step.name ?? 'step'}`, step.run!] as [string, string]),
    ]

    // Both templates must be represented, or a rename could silently empty this.
    expect(scripts.some(([name]) => name.startsWith('gitlab-ci.yml'))).toBe(true)
    expect(scripts.some(([name]) => name.startsWith('action.yml'))).toBe(true)

    for (const [name, script] of scripts) {
      for (const line of script.split('\n')) {
        // A jq result may be echoed or assigned, but must never be the
        // subject of a test that exits.
        if (/\bexit\b/.test(line) && /\bjq\b/.test(line)) {
          throw new Error(`${name}: exit decided from a jq expression: ${line.trim()}`)
        }
      }
      // Counts parsed for display must not feed a numeric comparison guarding an exit.
      expect(script).not.toMatch(/if \[ "\$(ORPHAN_COUNT|TRANSLATED|FAILED)"/)
      expect(script).not.toMatch(/if \[ "\$\{?(count|failed)\}?" -(gt|eq|lt) 0 \].*\n?\s*(exit|echo "::error)/)
    }
  })
})
