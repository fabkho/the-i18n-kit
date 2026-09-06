import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commands } from '../../src/commands/index.js'
import { descriptors, visibleParams } from '../../src/surface/descriptors.js'

/**
 * The drift guard.
 *
 * The CLI and the MCP server used to be two hand-written transcriptions of the
 * same operations, and nothing checked that they agreed: one called a parameter
 * `ref` and the other `referenceLocale`, with descriptions written months apart.
 * They are now generated from one table, and this file holds the table to what
 * it promises:
 *
 * - every operation with a `cli` really is a command the built binary answers
 * - the flags that command accepts are exactly the ones the table declares
 * - a parameter both surfaces expose is spelled the same on both, and one only
 *   a single surface exposes says so on the parameter
 *
 * The other half — that the server advertises exactly these operations with
 * exactly these parameters — is asserted in `packages/mcp/tests/descriptors.test.ts`,
 * which is where a server can be started. Together they close the loop.
 */

const execFileAsync = promisify(execFile)
const binPath = resolve(import.meta.dirname, '../../dist/bin.js')

async function runBin(args: string[]): Promise<{ stdout: string, code: number }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binPath, ...args])
    return { stdout, code: 0 }
  }
  catch (error) {
    const e = error as { stdout?: string, code?: number }
    return { stdout: e.stdout ?? '', code: e.code ?? 1 }
  }
}

/** Flags the shared command factory merges into every command. */
const SHARED_FLAGS = ['projectDir', 'json']

const cliDescriptors = descriptors.filter(descriptor => descriptor.cli !== null)
const mcpDescriptors = descriptors.filter(descriptor => descriptor.mcp !== null)
const bothDescriptors = descriptors.filter(d => d.cli !== null && d.mcp !== null)

describe('the operation table drives the CLI', () => {
  it('registers a command for every descriptor that declares one, and no other', () => {
    expect(Object.keys(commands).sort())
      .toEqual(cliDescriptors.map(descriptor => descriptor.cli?.name).sort())
  })

  // A registered command that cannot be invoked is worse than no command: it is
  // documented, tested at the unit level and dead at the only level that counts.
  // Only the real binary can show that, so this drives it. Requires a built dist.
  it.each(cliDescriptors.map(descriptor => descriptor.cli?.name ?? ''))(
    '%s is invocable through the binary',
    async (name) => {
      const { stdout, code } = await runBin([name, '--help'])

      expect(code).toBe(0)
      expect(stdout).toContain('USAGE')
    },
  )

  it('accepts exactly the flags the descriptor declares, plus the shared ones', async () => {
    for (const descriptor of cliDescriptors) {
      const def = await commands[descriptor.cli?.name ?? '']?.load()
      const declared = [...visibleParams(descriptor, 'cli'), ...SHARED_FLAGS]

      expect(Object.keys((def as { args: Record<string, unknown> }).args).sort())
        .toEqual(declared.sort())
    }
  })

  it('prints the descriptor description as the command description', async () => {
    for (const descriptor of cliDescriptors) {
      const def = await commands[descriptor.cli?.name ?? '']?.load()

      expect((def as { meta: { description: string } }).meta.description)
        .toBe(descriptor.description)
    }
  })
})

describe('the two surfaces agree', () => {
  it('spells a parameter the same way on both, or says which surface hides it', () => {
    for (const descriptor of bothDescriptors) {
      const cli = visibleParams(descriptor, 'cli')
      const mcp = visibleParams(descriptor, 'mcp')
      const hidden = Object.entries(descriptor.params)
        .filter(([, spec]) => spec.cli?.hidden === true || spec.mcp?.hidden === true)
        .map(([name]) => name)

      // Every difference between the two sets is a parameter the table hides on
      // one of them. A parameter that exists on one surface for no stated
      // reason is the drift this table was written to make impossible.
      const onlyCli = cli.filter(name => !mcp.includes(name))
      const onlyMcp = mcp.filter(name => !cli.includes(name))

      expect(onlyCli.filter(name => !hidden.includes(name))).toEqual([])
      expect(onlyMcp.filter(name => !hidden.includes(name))).toEqual([])
    }
  })

  it('keeps the previous CLI spelling of every renamed parameter reachable', () => {
    // The rename direction is towards the MCP name, so the flag someone has in
    // a pipeline has to survive it. Stated as a table because a lost alias is a
    // broken pipeline, not a failing type.
    const kept: Record<string, Record<string, string>> = {
      missing: { referenceLocale: 'ref', targetLocales: 'targets' },
      status: { referenceLocale: 'ref' },
      search: { searchIn: 'in' },
      translate: { referenceLocale: 'ref', targetLocales: 'targets' },
      'translate-key': { targetLocales: 'targets' },
    }

    for (const [command, aliases] of Object.entries(kept)) {
      const descriptor = descriptors.find(candidate => candidate.cli?.name === command)
      expect(descriptor, `no descriptor for ${command}`).toBeDefined()

      for (const [param, alias] of Object.entries(aliases)) {
        const declared = descriptor?.params[param]?.cli?.alias
        const spellings = typeof declared === 'string' ? [declared] : declared ?? []
        expect(spellings, `${command} --${param}`).toContain(alias)
      }
    }
  })

  it('leaves no operation without a surface', () => {
    for (const descriptor of descriptors) {
      expect(
        descriptor.cli !== null || descriptor.mcp !== null,
        `${descriptor.id} is reachable from neither surface`,
      ).toBe(true)
    }
  })

  it('gives every parameter a description written for a reader of either surface', () => {
    for (const descriptor of descriptors) {
      for (const [name, spec] of Object.entries(descriptor.params)) {
        expect(spec.description.length, `${descriptor.id}.${name}`).toBeGreaterThan(0)
        // No flag spellings in a shared description: an MCP host has no flags,
        // and the CLI adds what a shell needs when it builds the flag.
        expect(spec.description, `${descriptor.id}.${name}`).not.toMatch(/(^|\s)--\w/)
      }
    }
  })

  it('covers both surfaces, so neither is documented against an empty table', () => {
    expect(cliDescriptors.length).toBeGreaterThan(1)
    expect(mcpDescriptors.length).toBeGreaterThan(1)
  })
})
