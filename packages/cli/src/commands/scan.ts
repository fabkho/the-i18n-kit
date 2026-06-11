import { defineCommand } from 'citty'
import { scanCodeUsage } from '../core/operations.js'
import { sharedArgs, outputResult, splitList } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'scan',
    description: 'Scan source code for translation key usage (file paths + line numbers)',
  },
  args: {
    ...sharedArgs,
    keys: {
      type: 'string',
      description: 'Comma-separated keys to filter by',
    },
    outputFile: {
      type: 'string',
      description: 'Write full output to file, return summary only',
    },
  },
  async run({ args }) {
    const result = await scanCodeUsage({
      keys: splitList(args.keys),
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
    outputResult(result, args)
  },
})
