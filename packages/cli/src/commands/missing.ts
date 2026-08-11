import { createCommand, splitList } from './_shared.js'
import { getMissingTranslations } from '../core/operations.js'

export default createCommand({
  name: 'missing',
  description: 'Find translation keys missing in target locales',
  args: {
    layer: { type: 'string', description: 'Filter to a specific layer' },
    ref: { type: 'string', description: 'Reference locale (default: project default)' },
    targets: { type: 'string', description: 'Comma-separated target locales (default: all except ref)' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
    failOnMissing: { type: 'boolean', description: 'Exit 2 when any key is missing (CI gate)', default: false },
  },
  gates: [{ flag: 'failOnMissing', counter: 'totalMissingKeys', threshold: 0 }],
  async run(args) {
    return getMissingTranslations({
      layer: args.layer,
      referenceLocale: args.ref,
      targetLocales: splitList(args.targets),
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
  },
})
