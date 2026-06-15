import { createCommand } from './_shared.js'
import { listLocaleDirs } from '../core/operations.js'

export default createCommand({
  name: 'list-dirs',
  description: 'List all i18n locale directories, grouped by layer',
  async run(args) {
    return listLocaleDirs(args.projectDir)
  },
})
