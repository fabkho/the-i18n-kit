import { defineCommand } from 'citty'
import { scanKeys } from '../core/operations.js'
import { sharedArgs, outputResult, splitList } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'scan',
    description: 'Scan source code for translation key usage and find orphan keys',
  },
  args: {
    ...sharedArgs,
    keys: {
      type: 'string',
      description: 'Comma-separated keys to report on (default: all)',
    },
    layer: {
      type: 'string',
      description: 'Limit orphan detection to one layer',
    },
    locale: {
      type: 'string',
      description: 'Locale to read for orphan detection (default: project default)',
    },
    outputFile: {
      type: 'string',
      description: 'Write full output to this file path and return only a summary (useful for large outputs)',
    },
  },
  async run({ args }) {
    const result = await scanKeys({
      keys: splitList(args.keys),
      layer: args.layer,
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
    outputResult(result, args)
  },
})
