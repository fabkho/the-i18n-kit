import { createCommand, splitList } from './_shared.js'
import { scanCodeUsage } from '../core/operations.js'

export default createCommand({
  name: 'scan',
  description: 'Scan source code for translation key usage (file paths + line numbers)',
  args: {
    keys: { type: 'string', description: 'Comma-separated keys to filter by' },
    outputFile: { type: 'string', description: 'Write full output to file, return summary only' },
  },
  async run(args) {
    return scanCodeUsage({
      keys: splitList(args.keys),
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
  },
})
