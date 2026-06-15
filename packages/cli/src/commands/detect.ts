import { createCommand } from './_shared.js'
import { detectConfig } from '../core/operations.js'

export default createCommand({
  name: 'detect',
  description: 'Detect i18n configuration from the project',
  async run(args) {
    return detectConfig(args.projectDir)
  },
})
