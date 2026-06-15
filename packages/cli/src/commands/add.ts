import { createCommand, parseJsonArg } from './_shared.js'
import { addTranslations } from '../core/operations.js'

export default createCommand({
  name: 'add',
  description: 'Add new translation keys (skips keys that already exist)',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    translations: { type: 'string', description: 'JSON: { "key": { "en": "val", "de": "val" } }', required: true },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    const translations = parseJsonArg<Record<string, Record<string, string>>>(args.translations, 'translations')
    return addTranslations({ layer: args.layer, translations, dryRun: args.dryRun, projectDir: args.projectDir })
  },
})
