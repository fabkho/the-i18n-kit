import type { CommandDef } from 'citty'

/**
 * A registered command: its lazy loader, and whether the CLI exposes it.
 *
 * `hidden` sits on the entry rather than in a separate set so that adding a
 * command is one edit and the default is to be reachable. The set it replaced
 * lived in `cli.ts`, out of sight of anyone adding a command here, and the one
 * time it and the registry disagreed a documented command became uninvokable
 * (#307).
 */
export interface CommandEntry {
  load: () => Promise<CommandDef>
  /**
   * Kept out of the executed map, not merely out of `--help`: a hidden name
   * cannot be invoked at all. Only for operations reachable another way —
   * `discover` covers `detect` and `list-dirs`, `find_empty_translations`
   * covers `empty` (#252). A command with no other route must stay exposed.
   */
  hidden?: true
}

const command = (load: () => Promise<{ default: unknown }>): CommandEntry => ({
  load: () => load().then(m => m.default as CommandDef),
})

const hidden = (load: () => Promise<{ default: unknown }>): CommandEntry => ({
  ...command(load),
  hidden: true,
})

export const commands = {
  'init': command(() => import('./init.js')),
  'detect': hidden(() => import('./detect.js')),
  'list-dirs': hidden(() => import('./list-dirs.js')),
  'get': command(() => import('./get.js')),
  'write': command(() => import('./write.js')),
  'add': command(() => import('./add.js')),
  'update': command(() => import('./update.js')),
  'missing': command(() => import('./missing.js')),
  'status': command(() => import('./status.js')),
  'empty': hidden(() => import('./empty.js')),
  'search': command(() => import('./search.js')),
  'remove': command(() => import('./remove.js')),
  'rename': command(() => import('./rename.js')),
  'translate': command(() => import('./translate.js')),
  // Alias: same operation as `translate`, named to match the MCP tool
  // translate_missing so docs can use one name across both surfaces.
  'translate-missing': {
    load: () => import('./translate.js').then((m) => {
      const def = m.default as CommandDef
      return {
        ...def,
        meta: { ...(def.meta as object), name: 'translate-missing', description: 'Alias of "translate" — matches the MCP tool translate_missing.' },
      } as CommandDef
    }),
  },
  'translate-key': command(() => import('./translate-key.js')),
  // Deliberately exposed: key-usage scanning has no other route on either
  // surface, so hiding it made a documented command unreachable (#307).
  'scan': command(() => import('./scan.js')),
  'check': command(() => import('./check.js')),
  'find-duplicates': command(() => import('./find-duplicates.js')),
  'remove-orphans': command(() => import('./remove-orphans.js')),
  'scaffold': command(() => import('./scaffold.js')),
} as const satisfies Record<string, CommandEntry>

/** The names the CLI wires into citty — everything not marked hidden. */
export function exposedCommandNames(): string[] {
  return Object.entries(commands)
    .filter(([, entry]) => !(entry as CommandEntry).hidden)
    .map(([name]) => name)
}
