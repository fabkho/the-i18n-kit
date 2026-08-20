import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commands, exposedCommandNames } from '../../src/commands/index.js'

const execFileAsync = promisify(execFile)
const binPath = resolve(import.meta.dirname, '../../dist/bin.js')

/**
 * `scan` was documented, implemented, tested and unreachable: cli.ts filtered
 * it out of the map handed to citty, so it was absent from the *executed*
 * commands too, not merely from --help (#307).
 *
 * Unit tests of a command module cannot see that — the module is fine. Only
 * the real binary can, so this drives it. Requires a built dist.
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

// Derived, not restated: a third copy of the hidden list is a third thing to
// fall out of step with the registry, which is the drift #370 removed.
const publicCommands = exposedCommandNames()
const hiddenCommands = Object.keys(commands).filter(name => !publicCommands.includes(name))

describe('every public command is invocable through the binary', () => {
  it.each(publicCommands)('%s', async (name) => {
    const { stdout, code } = await runBin([name, '--help'])

    expect(code).toBe(0)
    expect(stdout).toContain('USAGE')
  })

  it('lists them all in the root help', async () => {
    const { stdout } = await runBin(['--help'])

    for (const name of publicCommands) {
      expect(stdout).toContain(name)
    }
  })
})

// The flag has to keep meaning what it says, in both directions: hiding a
// command removes it from the executed map, not merely from --help (#307).
describe('hidden commands', () => {
  it('names the ones reachable another way, and nothing else', () => {
    expect(hiddenCommands).toEqual(['detect', 'list-dirs', 'empty'])
  })

  // Invoked bare, not with --help: runCli hands any --help straight to citty,
  // which answers an unrecognised subcommand with the root usage and exits 0.
  it.each(hiddenCommands)('%s is not in the executed map', async (name) => {
    const { stdout, code } = await runBin([name, '--json'])

    expect(code).toBe(1)
    expect(JSON.parse(stdout).error.code).toBe('E_UNKNOWN_COMMAND')
  })
})

describe('scan', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-scan-'))
    await mkdir(join(projectDir, 'locales'), { recursive: true })
    await mkdir(join(projectDir, 'src'), { recursive: true })
    await writeFile(
      join(projectDir, '.i18n-mcp.json'),
      JSON.stringify({ defaultLocale: 'en', localeDirs: ['locales'], locales: ['en'] }),
    )
    await writeFile(join(projectDir, 'locales/en.json'), JSON.stringify({ a: { b: 'x' } }))
    await writeFile(join(projectDir, 'src/app.ts'), `const x = t('a.b')\n`)
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('reports where a key is used, with file and line', async () => {
    const { stdout, code } = await runBin(['scan', '--keys', 'a.b'], projectDir)

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      usages: { 'a.b': [{ file: 'src/app.ts', line: 1, callee: 't' }] },
      summary: { uniqueKeysFound: 1, totalReferences: 1 },
    })
  })

  it('auto-emits JSON when stdout is not a TTY, like the rest of the surface', async () => {
    const { stdout } = await runBin(['scan'], projectDir)

    expect(() => JSON.parse(stdout)).not.toThrow()
  })
})
