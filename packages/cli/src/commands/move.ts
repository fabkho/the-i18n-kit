import { createCommand } from './_shared.js'
import { moveTranslationKey } from '../core/operations.js'

export default createCommand({
  name: 'move',
  description: 'Move a translation key to another layer, another key path, or both — carrying every locale that defines it',
  args: {
    layer: { type: 'string', description: 'Layer the key lives in today', required: true },
    key: { type: 'string', description: 'Dot-separated key path to move', required: true },
    // Omitting this is a rename in place, so neither destination flag can be
    // required: which one you pass is what you meant to do.
    toLayer: { type: 'string', description: 'Layer to move it to (see layerGraph.shared in the discover output for where a shared key belongs). Omit to rename within the same layer' },
    newKey: { type: 'string', description: 'Key path to give it. Omit to keep the current path' },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    return moveTranslationKey({
      layer: args.layer,
      key: args.key,
      toLayer: args.toLayer,
      newKey: args.newKey,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
    })
  },
})
