import { createCommand } from './_shared.js'
import { moveTranslationKey } from '../core/operations.js'

export default createCommand({
  name: 'move',
  description: 'Move a translation key from one layer to another, carrying every locale that defines it',
  args: {
    fromLayer: { type: 'string', description: 'Layer the key lives in today', required: true },
    toLayer: { type: 'string', description: 'Layer to move it to (see layerGraph.shared from the MCP discover tool for where a shared key belongs)', required: true },
    key: { type: 'string', description: 'Dot-separated key path to move', required: true },
    newKey: { type: 'string', description: 'Key path in the target layer, when the move also renames it' },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    return moveTranslationKey({
      fromLayer: args.fromLayer,
      toLayer: args.toLayer,
      key: args.key,
      newKey: args.newKey,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
    })
  },
})
