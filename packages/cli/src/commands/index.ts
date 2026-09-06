import type { CommandDef } from 'citty'
import { commandFromDescriptor } from './_shared.js'
import { descriptors } from '../surface/descriptors.js'

/**
 * A registered command: nothing but its lazy loader.
 *
 * There is no way to register a command the CLI does not expose. The flag that
 * allowed it kept producing documented commands that printed "Unknown command"
 * when anyone tried them, and every operation an MCP tool covers has to be
 * reachable from a terminal or the two surfaces are not the same tool.
 *
 * The commands themselves are built from the operation descriptors, so the
 * registry states no name, no flag and no description of its own. The loader
 * stays because callers hold it: citty resolves subcommands through it, and the
 * reference generator awaits it. It also keeps the definition's identity
 * stable, which is how the generator recognises two names for one command.
 */
export interface CommandEntry {
  load: () => Promise<CommandDef>
}

function entry(build: () => CommandDef): CommandEntry {
  let built: CommandDef | undefined
  return { load: async () => (built ??= build()) }
}

function registry(): Record<string, CommandEntry> {
  const commands: Record<string, CommandEntry> = {}
  for (const descriptor of descriptors) {
    const cli = descriptor.cli
    if (cli === null) continue
    commands[cli.name] = entry(() => commandFromDescriptor(descriptor))
  }
  return commands
}

export const commands: Record<string, CommandEntry> = registry()
