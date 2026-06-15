import { createCommand, splitList } from './_shared.js'
import { scaffoldLocaleFiles } from '../core/operations.js'

export default createCommand({
  name: 'scaffold',
  description: 'Create empty locale files for new languages',
  args: {
    locales: { type: 'string', description: 'Comma-separated locale codes to scaffold' },
    layer: { type: 'string', description: 'Filter to a specific layer' },
    dryRun: { type: 'boolean', description: 'Preview without writing', default: false },
  },
  async run(args) {
    const locales = splitList(args.locales)
    if (locales && locales.length === 0) {
      throw new Error('No locales provided. Pass comma-separated locale codes via --locales')
    }
    return scaffoldLocaleFiles({ locales, layer: args.layer, dryRun: args.dryRun, projectDir: args.projectDir })
  },
})
