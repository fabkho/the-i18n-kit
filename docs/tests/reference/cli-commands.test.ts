/**
 * Contract tests for the CLI reference against the real command registry.
 *
 * The fixture tests in `build.test.ts` cover the builder's rules; these cover
 * the claim the site makes — that every command the CLI registers is
 * documented, with the flags and description it actually declares. Adding a
 * command and forgetting the docs cannot pass this file, because there is no
 * per-command list here to forget to update.
 *
 * Sources are loaded through the same loader the generator uses, so the only
 * disk access is the loader's own; the assertions all run against the builder's
 * in-memory output.
 */

import { describe, expect, it } from 'vitest'
import { commands } from '../../../packages/cli/src/commands/index.js'
import { GATE_MARKER, buildCliModel } from '../../generate/reference/cli-model.js'
import { buildReference } from '../../generate/reference/build.js'
import { loadCliSource } from '../../generate/sources/cli.js'
import type { CliSource } from '../../generate/reference/types.js'
import { commandPage, documentedFlags, overview, pagedCommands } from './helpers.js'

const source: CliSource = await loadCliSource()
const output = buildReference({ cli: source })
const model = buildCliModel(source)

/** Registry names that fold into another command's page rather than getting one. */
const aliasNames = model.commands.flatMap(command =>
  command.aliases.map(alias => alias.name),
)

describe('the CLI reference against the command registry', () => {
  it('documents every command the CLI exposes, on its own page or as an alias', () => {
    const documented = new Set([...pagedCommands(output), ...aliasNames])
    expect([...documented].sort()).toEqual([...source.exposed].sort())
  })

  it('documents no command the CLI filters out of its own registry', () => {
    // Those cannot be invoked — running one prints "Unknown command" — because
    // the operations are reachable through MCP tools instead. A page for one
    // would document a command that fails when a reader tries it.
    const hidden = Object.keys(commands).filter(name => !source.exposed.includes(name))
    expect(hidden.length).toBeGreaterThan(0)

    for (const name of hidden) {
      expect(output.has(`content/9.reference/1.cli/${name}.md`)).toBe(false)
      expect(overview(output)).not.toContain(`\`${name}\``)
    }
  })

  it('links every command page from the overview', () => {
    const markdown = overview(output)
    for (const name of pagedCommands(output)) {
      expect(markdown).toContain(`(/reference/cli/${name})`)
    }
    for (const name of aliasNames) {
      expect(markdown).toContain(`\`${name}\``)
    }
  })

  it('uses each command definition description, unaltered, as its page description', () => {
    for (const command of model.commands) {
      const markdown = commandPage(output, command.name)
      const declared = command.description
      expect(declared.length).toBeGreaterThan(0)
      expect(markdown).toContain(declared)
    }
  })

  it('documents each command-specific flag on its command page and nowhere else', () => {
    const shared = new Set(model.sharedArgs.map(arg => arg.name))

    for (const command of model.commands) {
      const expected = command.args.map(arg => arg.name).filter(name => !shared.has(name))
      const documented = documentedFlags(commandPage(output, command.name))
      expect([...documented].sort()).toEqual([...expected].sort())
    }
  })

  it('renders the shared flags once on the overview and on no command page', () => {
    expect(model.sharedArgs.length).toBeGreaterThan(0)
    const onOverview = documentedFlags(overview(output))

    for (const arg of model.sharedArgs) {
      expect(onOverview).toContain(arg.name)
      for (const command of model.commands) {
        expect(documentedFlags(commandPage(output, command.name))).not.toContain(arg.name)
      }
    }
  })

  it('separates out exactly the flags the shared command factory merges in', () => {
    // Guards against the intersection collapsing to nothing (every flag then
    // repeats on every page) or swallowing a genuinely command-specific flag.
    expect(model.sharedArgs.map(arg => arg.name).sort()).toEqual(['json', 'projectDir'])
  })

  it('folds translate-missing into translate rather than duplicating the page', () => {
    expect(Object.keys(commands)).toContain('translate-missing')
    expect(pagedCommands(output)).not.toContain('translate-missing')
    expect(commandPage(output, 'translate')).toContain('translate-missing')
  })

  it('documents every gate flag the CLI declares on the overview', () => {
    const gateFlags = model.commands.flatMap(command =>
      command.args.filter(arg => arg.description.includes(GATE_MARKER)).map(arg => arg.name),
    )
    expect(gateFlags.length).toBeGreaterThan(0)

    const onOverview = documentedFlags(overview(output))
    for (const flag of gateFlags) expect(onOverview).toContain(flag)
  })


  it('reports the exit codes the shared command factory assigns', () => {
    const markdown = overview(output)
    for (const code of Object.values(source.exitCodes)) {
      expect(markdown).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`))
    }
  })
})
