import { createCommand, parseJsonArg } from './_shared.js'
import { writeTranslations } from '../core/operations.js'

export default createCommand({
  name: 'write',
  description: 'Write translation keys (add/update/upsert). Default mode: upsert.',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    translations: { type: 'string', description: 'JSON: { "key": { "en": "val", "de": "val" } }', required: true },
    mode: { type: 'string', description: 'Write mode: add | update | upsert (default: upsert)', default: 'upsert' },
    dryRun: { type: 'boolean', description: 'Preview changes without writing', default: false },
  },
  async run(args) {
    const translations = parseJsonArg<Record<string, Record<string, string>>>(args.translations, 'translations')
    const mode = args.mode as 'add' | 'update' | 'upsert'
    return writeTranslations({ layer: args.layer, translations, mode, dryRun: args.dryRun, projectDir: args.projectDir })
  },
})
