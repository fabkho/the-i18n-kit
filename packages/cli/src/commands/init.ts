import { createCommand } from './_shared.js'
import { initProjectConfig } from '../core/operations.js'

export default createCommand({
  name: 'init',
  description: 'Create a schema-valid .i18n-mcp.json from framework detection. Non-interactive; refuses to overwrite without --force',
  args: {
    force: { type: 'boolean', description: 'Overwrite an existing .i18n-mcp.json', default: false },
    dryRun: { type: 'boolean', description: 'Report the config that would be written without touching disk', default: false },
  },
  async run(args) {
    return initProjectConfig({
      projectDir: args.projectDir,
      force: args.force,
      dryRun: args.dryRun,
    })
  },
})
