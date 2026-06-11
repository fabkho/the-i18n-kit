import type { CommandDef } from 'citty'

export const commands = {
  'detect': () => import('./detect.js').then(m => m.default as CommandDef),
  'list-dirs': () => import('./list-dirs.js').then(m => m.default as CommandDef),
  'get': () => import('./get.js').then(m => m.default as CommandDef),
  'write': () => import('./write.js').then(m => m.default as CommandDef),
  'add': () => import('./add.js').then(m => m.default as CommandDef),
  'update': () => import('./update.js').then(m => m.default as CommandDef),
  'missing': () => import('./missing.js').then(m => m.default as CommandDef),
  'empty': () => import('./empty.js').then(m => m.default as CommandDef),
  'search': () => import('./search.js').then(m => m.default as CommandDef),
  'remove': () => import('./remove.js').then(m => m.default as CommandDef),
  'rename': () => import('./rename.js').then(m => m.default as CommandDef),
  'translate': () => import('./translate.js').then(m => m.default as CommandDef),
  'translate-key': () => import('./translate-key.js').then(m => m.default as CommandDef),
  'scan': () => import('./scan.js').then(m => m.default as CommandDef),
  'cleanup': () => import('./cleanup.js').then(m => m.default as CommandDef),
  'scaffold': () => import('./scaffold.js').then(m => m.default as CommandDef),
} as const
