import type { CommandDef } from 'citty'

/**
 * A registered command: nothing but its lazy loader.
 *
 * There is no way to register a command the CLI does not expose. The flag that
 * allowed it kept producing documented commands that printed "Unknown command"
 * when anyone tried them, and every operation an MCP tool covers has to be
 * reachable from a terminal or the two surfaces are not the same tool.
 */
export interface CommandEntry {
  load: () => Promise<CommandDef>
}

const command = (load: () => Promise<{ default: unknown }>): CommandEntry => ({
  load: () => load().then(m => m.default as CommandDef),
})

export const commands = {
  'init': command(() => import('./init.js')),
  'discover': command(() => import('./discover.js')),
  'get': command(() => import('./get.js')),
  'write': command(() => import('./write.js')),
  'missing': command(() => import('./missing.js')),
  'status': command(() => import('./status.js')),
  'search': command(() => import('./search.js')),
  'remove': command(() => import('./remove.js')),
  'move': command(() => import('./move.js')),
  'translate': command(() => import('./translate.js')),
  'translate-key': command(() => import('./translate-key.js')),
  'check': command(() => import('./check.js')),
  'orphans': command(() => import('./orphans.js')),
  'find-duplicates': command(() => import('./find-duplicates.js')),
  'scaffold': command(() => import('./scaffold.js')),
} as const satisfies Record<string, CommandEntry>
