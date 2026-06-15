import { createCommand, parseJsonArg } from './_shared.js'
import { updateTranslations } from '../core/operations.js'

export default createCommand({
  name: 'update',
  description: 'Update existing translation keys (skips keys that do not exist)',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    translations: { type: 'string', description: 'JSON: { "key": { "en": "val", "de": "val" } }', required: true },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    const translations = parseJsonArg<Record<string, Record<string, string>>>(args.translations, 'translations')
    return updateTranslations({ layer: args.layer, translations, dryRun: args.dryRun, projectDir: args.projectDir })
  },
})
