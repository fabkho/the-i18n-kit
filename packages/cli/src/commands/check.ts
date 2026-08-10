import { createCommand } from './_shared.js'
import { checkUndefinedKeys } from '../core/operations.js'

/**
 * CI gate for `check`: any undefined-key finding fails the build.
 * Reads summary.undefinedCount, so it works for inline results and for
 * the { reportFile, summary } shape alike. Uncertain findings never fail.
 */
export function hasUndefinedKeys(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const summary = (result as Record<string, unknown>).summary
  if (summary === null || typeof summary !== 'object') return false
  const count = (summary as Record<string, unknown>).undefinedCount
  return typeof count === 'number' && count > 0
}

export default createCommand({
  name: 'check',
  description: 'Find keys referenced in code but defined in no consumed locale layer (they render as raw keys); exits non-zero when any are found',
  args: {
    locale: { type: 'string', description: 'Reference locale to resolve definitions in (default: project default)' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
    codequalityOutput: { type: 'string', description: 'Also write the findings as a GitLab Code Quality (CodeClimate) JSON report to this file path' },
  },
  failWhen: hasUndefinedKeys,
  async run(args) {
    return checkUndefinedKeys({
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
      codequalityOutput: args.codequalityOutput,
    })
  },
})
