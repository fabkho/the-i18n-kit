import { createCommand, splitList } from './_shared.js'
import { findOrphanKeys, removeOrphanKeys, scanCodeUsage } from '../core/operations.js'

/**
 * Three questions about one subject, so one command: which keys nothing
 * references, where the references that do exist are, and delete the first set.
 *
 * `--remove` is the only destructive spelling, and it has to be typed. The
 * previous command was named for the deletion and defaulted to not doing it,
 * which reads as a safeguard that could be dropped rather than as the default
 * it is.
 */
export default createCommand({
  name: 'orphans',
  description: 'Report translation keys no source code references. Nothing is deleted without --remove',
  args: {
    layer: { type: 'string', description: 'Filter to a specific layer' },
    locale: { type: 'string', description: 'Locale to read keys from (default: project default)' },
    remove: { type: 'boolean', description: 'Delete the orphan keys from every locale file. Uncertain and misplaced keys are never deleted', default: false },
    usages: { type: 'boolean', description: 'Report where keys are referenced in source (file paths and line numbers) instead of which are unreferenced', default: false },
    keys: { type: 'string', description: 'Comma-separated keys to report usages for (with --usages)' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
    codequalityOutput: { type: 'string', description: 'Also write the orphan findings as a GitLab Code Quality (CodeClimate) JSON report to this file path' },
    failOnOrphans: { type: 'boolean', description: 'Exit 2 when any orphan key is found (CI gate)', default: false },
  },
  gates: [{ flag: 'failOnOrphans', counter: 'orphanCount', threshold: 0 }],
  async run(args) {
    if (args.usages) {
      if (args.remove) {
        throw new Error('--usages reports where keys are used and never writes. Drop --remove, or drop --usages to delete orphans.')
      }
      return scanCodeUsage({
        keys: splitList(args.keys),
        projectDir: args.projectDir,
        outputFile: args.outputFile,
      })
    }

    if (args.remove) {
      return removeOrphanKeys({
        layer: args.layer,
        locale: args.locale,
        dryRun: false,
        projectDir: args.projectDir,
        outputFile: args.outputFile,
        codequalityOutput: args.codequalityOutput,
      })
    }

    return findOrphanKeys({
      layer: args.layer,
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
      codequalityOutput: args.codequalityOutput,
    })
  },
})
