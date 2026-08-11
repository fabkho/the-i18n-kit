import { createCommand } from './_shared.js'
import { removeOrphanKeys } from '../core/operations.js'

export default createCommand({
  name: 'remove-orphans',
  description: 'Find and remove orphan translation keys not referenced in source code',
  args: {
    layer: { type: 'string', description: 'Filter to a specific layer' },
    locale: { type: 'string', description: 'Locale to check (default: project default)' },
    dryRun: { type: 'boolean', description: 'Preview without removing (default: true)', default: true },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
    codequalityOutput: { type: 'string', description: 'Also write the orphan findings as a GitLab Code Quality (CodeClimate) JSON report to this file path' },
    failOnOrphans: { type: 'boolean', description: 'Exit 2 when any orphan key is found (CI gate)', default: false },
  },
  gates: [{ flag: 'failOnOrphans', counter: 'orphanCount', threshold: 0 }],
  async run(args) {
    return removeOrphanKeys({
      layer: args.layer,
      locale: args.locale,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
      codequalityOutput: args.codequalityOutput,
    })
  },
})
