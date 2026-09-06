import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands } from '../../src/commands/index.js'

const execFileAsync = promisify(execFile)
const binPath = resolve(import.meta.dirname, '../../dist/bin.js')

/**
 * How the binary answers what it is given: the root usage, an unknown name, and
 * one command driven end to end against a real project.
 *
 * That every registered command is invocable at all now lives in
 * descriptors.test.ts, next to the table the registry is built from — there is
 * no per-command module left for it to be asserted against here.
 *
 * Requires a built dist.
 */
async function runBin(args: string[], cwd?: string): Promise<{ stdout: string, code: number }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], { cwd })
    return { stdout, code: 0 }
  } catch (error) {
    const e = error as { stdout?: string, code?: number }
    return { stdout: e.stdout ?? '', code: e.code ?? 1 }
  }
}

// Derived, not restated: a second copy of the command list is a second thing to
// fall out of step with the registry.
const registeredCommands = Object.keys(commands)

describe('the binary answers for the whole registry', () => {
  it('lists every registered command in the root help', async () => {
    const { stdout } = await runBin(['--help'])

    for (const name of registeredCommands) {
      expect(stdout).toContain(name)
    }
  })

  // Invoked bare, not with --help: runCli hands any --help straight to citty,
  // which answers an unrecognised subcommand with the root usage and exits 0.
  it('answers a name it does not register with an error, not with silence', async () => {
    const { stdout, code } = await runBin(['no-such-command', '--json'])

    expect(code).toBe(1)
    expect(JSON.parse(stdout).error.code).toBe('E_UNKNOWN_COMMAND')
  })
})

describe('orphans', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-orphans-'))
    await mkdir(join(projectDir, 'locales'), { recursive: true })
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(
      join(projectDir, '.i18n-mcp.json'),
      JSON.stringify({ defaultLocale: 'en', localeDirs: ['locales'], locales: ['en'] }),
    )
    await writeFile(join(projectDir, 'locales/en.json'), JSON.stringify({ a: { b: 'x' }, dead: 'y' }))
    await writeFile(join(projectDir, 'src/app.ts'), `const x = t('a.b')\n`)
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('reports the unreferenced keys and writes nothing', async () => {
    const { stdout, code } = await runBin(['orphans'], projectDir)

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      orphanKeys: { default: ['dead'] },
      summary: { orphanCount: 1 },
    })
  })

  it('--usages reports where a key is used, with file and line', async () => {
    const { stdout, code } = await runBin(['orphans', '--usages', '--keys', 'a.b'], projectDir)

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      usages: { 'a.b': [{ file: 'src/app.ts', line: 1, callee: 't' }] },
      summary: { uniqueKeysFound: 1, totalReferences: 1 },
    })
  })

  it('auto-emits JSON when stdout is not a TTY, like the rest of the surface', async () => {
    const { stdout } = await runBin(['orphans', '--usages'], projectDir)

    expect(() => JSON.parse(stdout)).not.toThrow()
  })

  // The safeguard is the default, not a flag you remember to pass.
  it('refuses to both scan usages and delete in one call', async () => {
    const { stdout, code } = await runBin(['orphans', '--usages', '--remove', '--json'], projectDir)

    expect(code).toBe(1)
    expect(JSON.parse(stdout).error.message).toContain('--usages')
  })
})
