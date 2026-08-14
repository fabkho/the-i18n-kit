import type { CommandDef } from 'citty'

export const commands = {
  'init': () => import('./init.js').then(m => m.default as CommandDef),
  'detect': () => import('./detect.js').then(m => m.default as CommandDef),
  'list-dirs': () => import('./list-dirs.js').then(m => m.default as CommandDef),
  'get': () => import('./get.js').then(m => m.default as CommandDef),
  'write': () => import('./write.js').then(m => m.default as CommandDef),
  'add': () => import('./add.js').then(m => m.default as CommandDef),
  'update': () => import('./update.js').then(m => m.default as CommandDef),
  'missing': () => import('./missing.js').then(m => m.default as CommandDef),
  'status': () => import('./status.js').then(m => m.default as CommandDef),
  'empty': () => import('./empty.js').then(m => m.default as CommandDef),
  'search': () => import('./search.js').then(m => m.default as CommandDef),
  'remove': () => import('./remove.js').then(m => m.default as CommandDef),
  'rename': () => import('./rename.js').then(m => m.default as CommandDef),
  'translate': () => import('./translate.js').then(m => m.default as CommandDef),
  // Alias: same operation as `translate`, named to match the MCP tool
  // translate_missing so docs can use one name across both surfaces.
  'translate-missing': () => import('./translate.js').then((m) => {
    const def = m.default as CommandDef
    return {
      ...def,
      meta: { ...(def.meta as object), name: 'translate-missing', description: 'Alias of "translate" — matches the MCP tool translate_missing.' },
    } as CommandDef
  }),
  'translate-key': () => import('./translate-key.js').then(m => m.default as CommandDef),
  'scan': () => import('./scan.js').then(m => m.default as CommandDef),
  'check': () => import('./check.js').then(m => m.default as CommandDef),
  'find-duplicates': () => import('./find-duplicates.js').then(m => m.default as CommandDef),
  'remove-orphans': () => import('./remove-orphans.js').then(m => m.default as CommandDef),
  'scaffold': () => import('./scaffold.js').then(m => m.default as CommandDef),
} as const
