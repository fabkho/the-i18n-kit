/**
 * Loads the CLI reference's sources.
 *
 * The command registry maps names to lazy loaders, so every entry has to be
 * resolved before anything can be read off it. That is asynchronous and, for
 * the exposed set, reads a file — which is why it lives here rather than in the
 * builder.
 *
 * The registry is imported from source rather than from `dist`, because
 * `tsdown` emits content-hashed chunks and the registry is not one of the
 * package's public entry points. Both are TypeScript, both run under the same
 * loader, and the source is the thing that would have to change for the
 * reference to go stale anyway.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { commands } from '../../../packages/cli/src/commands/index.js'
import {
  EXIT_GATE_TRIPPED,
  EXIT_RUN_FAILED,
  EXIT_SUCCESS,
} from '../../../packages/cli/src/commands/_shared.js'
import type { CliCommandEntry, CliSource, CommandDefLike } from '../reference/types.js'

const CLI_ENTRY = new URL('../../../packages/cli/src/cli.ts', import.meta.url)

export async function loadCliSource(): Promise<CliSource> {
  const [entries, exposed] = await Promise.all([resolveEntries(), loadExposedNames()])
  return {
    entries,
    exposed,
    exitCodes: {
      success: EXIT_SUCCESS,
      runFailed: EXIT_RUN_FAILED,
      gateTripped: EXIT_GATE_TRIPPED,
    },
  }
}

/** Resolve every lazy loader in the registry, preserving registry order. */
async function resolveEntries(): Promise<CliCommandEntry[]> {
  const names = Object.keys(commands) as (keyof typeof commands)[]
  return Promise.all(
    names.map(async name => ({
      name: name as string,
      def: (await commands[name]()) as CommandDefLike,
    })),
  )
}

/**
 * The registry names the CLI wires into its subcommands.
 *
 * `cli.ts` filters a hidden set out of the registry before handing it to citty,
 * so a registered name is not necessarily a runnable one. That set is
 * module-private, and the alternative to reading it is publishing pages for
 * commands that report an unknown command when run. Reading it here means the
 * pages follow the filter; a change to the shape of the declaration fails this
 * loader loudly rather than silently marking every command reachable.
 */
async function loadExposedNames(): Promise<string[]> {
  const hidden = await loadHiddenNames()
  return Object.keys(commands).filter(name => !hidden.has(name))
}

async function loadHiddenNames(): Promise<Set<string>> {
  const source = await readFile(fileURLToPath(CLI_ENTRY), 'utf-8')
  const declaration = /const hiddenCommands = new Set\(\[([^\]]*)\]\)/.exec(source)
  if (declaration === null || declaration[1] === undefined) {
    throw new Error(
      'Could not find the hiddenCommands declaration in packages/cli/src/cli.ts. '
      + 'The CLI reference derives which registered commands are reachable from it — '
      + 'update the pattern in docs/generate/sources/cli.ts to match the new shape.',
    )
  }
  return new Set([...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1] as string))
}
