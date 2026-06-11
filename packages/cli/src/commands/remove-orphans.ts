import { defineCommand } from 'citty'
import { removeOrphanKeys } from '../core/operations.js'
import { sharedArgs, outputResult } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'remove-orphans',
    description: 'Find and remove orphan translation keys not referenced in source code',
  },
  args: {
    ...sharedArgs,
    layer: {
      type: 'string',
      description: 'Filter to a specific layer',
    },
    locale: {
      type: 'string',
      description: 'Locale to check (default: project default)',
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview without removing (default: true)',
      default: true,
    },
    outputFile: {
      type: 'string',
      description: 'Write full output to this file path and return only a summary (useful for large outputs)',
    },
  },
  async run({ args }) {
    const result = await removeOrphanKeys({
      layer: args.layer,
      locale: args.locale,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
    outputResult(result, args)
  },
})
