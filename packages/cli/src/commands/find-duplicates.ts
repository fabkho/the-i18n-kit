import { createCommand } from './_shared.js'
import { findDuplicateKeys } from '../core/operations.js'

export default createCommand({
  name: 'find-duplicates',
  description: 'Find keys defined in both a shared layer and a consuming child layer (with divergence detection); --byValue also finds different keys carrying the same value',
  args: {
    locale: { type: 'string', description: 'Locale to compare values in (default: project default)' },
    byValue: { type: 'boolean', description: 'Also group different keys carrying the same value, ranked by what to do about each group', default: false },
    minValueLength: { type: 'string', description: 'Shortest value worth grouping with --byValue (default: 4) — below it, repetition is usually legitimate' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
  },
  async run(args) {
    return findDuplicateKeys({
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
      byValue: args.byValue,
      ...(args.minValueLength ? { minValueLength: Number(args.minValueLength) } : {}),
    })
  },
})
