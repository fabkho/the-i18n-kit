import { createCommand } from './_shared.js'
import { renameTranslationKey } from '../core/operations.js'

export default createCommand({
  name: 'rename',
  description: 'Rename/move a translation key across all locale files',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    oldKey: { type: 'string', description: 'Current key path', required: true },
    newKey: { type: 'string', description: 'New key path', required: true },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    return renameTranslationKey({
      layer: args.layer,
      oldKey: args.oldKey,
      newKey: args.newKey,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
    })
  },
})
