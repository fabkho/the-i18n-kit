import { defineCommand } from 'citty'
import { writeTranslations } from '../core/operations.js'
import { sharedArgs, outputResult, parseJsonArg } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'write',
    description: 'Write translation keys (add/update/upsert). Default mode: upsert.',
  },
  args: {
    ...sharedArgs,
    layer: {
      type: 'string',
      description: 'Layer name',
      required: true,
    },
    translations: {
      type: 'string',
      description: 'JSON: { "key": { "en": "val", "de": "val" } }',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'Write mode: add | update | upsert (default: upsert)',
      default: 'upsert',
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview changes without writing',
      default: false,
    },
  },
  async run({ args }) {
    const translations = parseJsonArg<Record<string, Record<string, string>>>(
      args.translations,
      'translations',
    )
    const mode = args.mode as 'add' | 'update' | 'upsert'
    const result = await writeTranslations({
      layer: args.layer,
      translations,
      mode,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
    })
    outputResult(result, args)
  },
})
