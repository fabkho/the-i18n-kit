import { createCommand } from './_shared.js'
import { describeProject } from '../core/operations.js'

export default createCommand({
  name: 'discover',
  description: 'Describe the project: detected config, locale directories per layer, the layer graph, and the hand-maintained locales',
  async run(args) {
    return describeProject({ projectDir: args.projectDir })
  },
})
