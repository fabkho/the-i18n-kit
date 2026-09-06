import { createCommand } from './_shared.js'
import { getTranslationStatus } from '../core/operations.js'

export default createCommand({
  name: 'status',
  description: 'Translation coverage per locale and per layer, with an overall completion percentage',
  args: {
    layer: { type: 'string', description: 'Filter to a specific layer' },
    ref: { type: 'string', description: 'Reference locale (default: project default)' },
    // The summary already counts empty values; this names them. A flag rather
    // than a command of its own, because "which keys are empty" is a follow-up
    // to the coverage figure, not a separate question.
    listEmpty: { type: 'boolean', description: 'Also list the keys whose value is an empty string, under "empty"', default: false },
    outputFile: { type: 'string', description: 'Write the full breakdown to this file path and return only a summary' },
    failUnder: { type: 'string', description: 'Exit 2 when overall completion is below this percentage (CI gate)' },
  },
  // Threshold comes from the flag's own value; `direction: below` is what
  // makes this a floor rather than a ceiling (see resolveExitCode).
  gates: [{ flag: 'failUnder', counter: 'completionPercent', direction: 'below' }],
  async run(args) {
    return getTranslationStatus({
      layer: args.layer,
      referenceLocale: args.ref,
      listEmpty: args.listEmpty,
      projectDir: args.projectDir,
      outputFile: args.outputFile,
    })
  },
})
