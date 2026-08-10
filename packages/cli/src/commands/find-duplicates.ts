import { createCommand } from './_shared.js'
import { findDuplicateKeys } from '../core/operations.js'

export default createCommand({
  name: 'find-duplicates',
  description: 'Find keys defined in both a shared layer and a consuming child layer (with divergence detection)',
  args: {
    locale: { type: 'string', description: 'Locale to compare values in (default: project default)' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
  },
  async run(args) {
    return findDuplicateKeys({
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
  },
})
