import { createCommand } from './_shared.js'
import { checkUndefinedKeys } from '../core/operations.js'

export default createCommand({
  name: 'check',
  description: 'Find keys referenced in code but defined in no consumed locale layer (they render as raw keys); findings trip an always-on gate and exit 2, distinct from exit 1 for a run that failed',
  args: {
    locale: { type: 'string', description: 'Reference locale to resolve definitions in (default: project default)' },
    outputFile: { type: 'string', description: 'Write full output to this file path and return only a summary (useful for large outputs)' },
    codequalityOutput: { type: 'string', description: 'Also write the findings as a GitLab Code Quality (CodeClimate) JSON report to this file path' },
  },
  /**
   * Always on, and a gate rather than a run failure. A key that renders raw in
   * production is a defect, so there is no flag to opt into caring about it —
   * but it is still a finding, and reporting it as exit 1 left the caller
   * unable to tell an undefined key from a scan that fell over (#369).
   *
   * Reads summary.undefinedCount, so it trips on inline results and on the
   * { reportFile, summary } shape alike. Uncertain findings never trip it.
   */
  gates: [{ name: 'undefined-keys', counter: 'undefinedCount', threshold: 0 }],
  async run(args) {
    return checkUndefinedKeys({
      locale: args.locale,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
      codequalityOutput: args.codequalityOutput,
    })
  },
})
