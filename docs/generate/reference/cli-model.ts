/**
 * Turns the resolved command registry into the model the CLI pages render from.
 *
 * Three things happen here, all of them derived rather than declared, so that
 * adding a command, a flag or an alias needs no edit in this directory:
 *
 * - aliases fold into the command they alias, by handler identity
 * - flags declared identically on every command are separated out as shared
 * - gate flags are recognised by the marker their descriptions carry
 */

import type {
  ArgDefLike,
  ArgDoc,
  CliCommandEntry,
  CliSource,
  CommandDoc,
  GateSpecLike,
} from './types.js'

/**
 * The marker `createCommand`'s gate flags carry in their descriptions. Gate
 * specs are passed to the factory and not retained on the definition, so the
 * flag's own description is the only machine-readable trace of a gate.
 */
export const GATE_MARKER = '(CI gate)'

export interface CliModel {
  /** One per command, aliases folded in, registry order preserved. */
  commands: CommandDoc[]
  /** Flags every command declares identically. */
  sharedArgs: ArgDoc[]
}

export function buildCliModel(source: CliSource): CliModel {
  const commands = foldAliases(source.entries, new Set(source.exposed))
  return { commands, sharedArgs: sharedArgs(commands) }
}

/** Flags of a command that are not part of the shared set. */
export function specificArgs(command: CommandDoc, shared: ArgDoc[]): ArgDoc[] {
  const sharedNames = new Set(shared.map(arg => arg.name))
  return command.args.filter(arg => !sharedNames.has(arg.name))
}

/** The gate flags a command declares, recognised by the marker in their description. */
export function gateArgs(command: CommandDoc): ArgDoc[] {
  return command.args.filter(arg => arg.description.includes(GATE_MARKER))
}

/**
 * Gates a command evaluates without being asked, taken from the definition.
 *
 * These have no flag, so there is no description to read them off — which is
 * why `check` was absent from the gate table while its gate was expressed as a
 * bare predicate (#369).
 */
export function alwaysOnGates(command: CommandDoc): GateSpecLike[] {
  return command.gates.filter(gate => gate.flag === undefined)
}

/**
 * Flags declared identically on every command.
 *
 * Derived by intersection rather than imported from the CLI's `sharedArgs`
 * constant, which is module-private. The intersection is also the definition
 * that matters for the reader: a flag on every page belongs on none of them.
 */
function sharedArgs(commands: CommandDoc[]): ArgDoc[] {
  const [first, ...rest] = commands
  if (first === undefined) return []
  return first.args.filter(arg =>
    rest.every(command => command.args.some(other => sameArg(arg, other))),
  )
}

function sameArg(a: ArgDoc, b: ArgDoc): boolean {
  return a.name === b.name
    && a.type === b.type
    && a.description === b.description
    && String(a.default) === String(b.default)
}

/**
 * Group entries that resolve to the same handler.
 *
 * `translate-missing` re-exports `translate` with different metadata so the CLI
 * and the MCP tool `translate_missing` can be documented under one operation.
 * Comparing handler identity rather than matching on the description means a
 * future alias folds in without a generator change, and a command that merely
 * happens to be described similarly is never mistaken for one.
 */
function foldAliases(entries: CliCommandEntry[], exposed: Set<string>): CommandDoc[] {
  const byHandler = new Map<unknown, CommandDoc>()
  const commands: CommandDoc[] = []

  for (const entry of entries) {
    // Commands the CLI filters out of its own registry cannot be invoked at
    // all — running one prints "Unknown command". They are internal on purpose:
    // `discover` covers `detect` and `list-dirs`, and `find_empty_translations`
    // covers `empty`, so the operations are reachable, just not as commands.
    // Documenting them, even behind a warning, publishes an internal decision
    // as though it were a gap in the tool.
    if (!exposed.has(entry.name)) continue

    const handler = entry.def.run
    const target = handler === undefined ? undefined : byHandler.get(handler)
    if (target !== undefined) {
      target.aliases.push({ name: entry.name, description: description(entry) })
      continue
    }
    const command = toCommandDoc(entry)
    commands.push(command)
    if (handler !== undefined) byHandler.set(handler, command)
  }

  return commands
}

function toCommandDoc(entry: CliCommandEntry): CommandDoc {
  return {
    name: entry.name,
    description: description(entry),
    args: toArgDocs(entry.def.args),
    aliases: [],
    gates: entry.def.gates ?? [],
  }
}

/**
 * The registry key wins over `meta.name`: it is what the user types, and an
 * alias sets its own `meta.name` to match.
 */
function description(entry: CliCommandEntry): string {
  return entry.def.meta?.description ?? ''
}

function toArgDocs(args: Record<string, ArgDefLike> | undefined): ArgDoc[] {
  return Object.entries(args ?? {}).map(([name, def]) => ({
    name,
    type: def.type ?? 'string',
    description: def.description ?? '',
    required: def.required === true,
    default: def.default,
    alias: toArray(def.alias),
    valueHint: def.valueHint,
  }))
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
