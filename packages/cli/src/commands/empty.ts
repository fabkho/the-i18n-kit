import { createCommand } from './_shared.js'
import { findEmptyTranslations } from '../core/operations.js'

export default createCommand({
  name: 'empty',
  description: 'Find translation keys with empty string values',
  args: {
    layer: { type: 'string', description: 'Filter to a specific layer' },
    locale: { type: 'string', description: 'Filter to a specific locale' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
  },
  async run(args) {
    return findEmptyTranslations({
      layer: args.layer,
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
  },
})
