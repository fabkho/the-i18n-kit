/**
 * Loads the CLI reference's sources.
 *
 * The command registry maps names to lazy loaders, so every entry has to be
 * resolved before anything can be read off it. That is asynchronous, which is
 * why it lives here rather than in the builder.
 *
 * Every registered command is a command the CLI exposes, so the registry keys
 * are the whole surface and there is nothing to filter. There used to be a
 * hidden flag, and with it a generator that had to answer "documented but
 * uninvokable" for commands nobody could run.
 *
 * The registry is imported from source rather than from `dist`, because
 * `tsdown` emits content-hashed chunks and the registry is not one of the
 * package's public entry points. Both are TypeScript, both run under the same
 * loader, and the source is the thing that would have to change for the
 * reference to go stale anyway.
 */

import { commands } from '../../../packages/cli/src/commands/index.js'
import {
  EXIT_GATE_TRIPPED,
  EXIT_RUN_FAILED,
  EXIT_SUCCESS,
} from '../../../packages/cli/src/commands/_shared.js'
import type { CliCommandEntry, CliSource, CommandDefLike } from '../reference/types.js'

export async function loadCliSource(): Promise<CliSource> {
  return {
    entries: await resolveEntries(),
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
      def: (await commands[name].load()) as CommandDefLike,
    })),
  )
}
