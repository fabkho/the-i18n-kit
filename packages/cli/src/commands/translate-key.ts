import { createCommand, splitList, providerArgs, resolveProviderTranslateFn } from './_shared.js'
import { translateKey } from '../core/operations.js'

export default createCommand({
  name: 'translate-key',
  description: 'Translate a single key from a source locale into target locales. Supports LLM translation with --provider.',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    key: { type: 'string', description: 'Dot-separated translation key', required: true },
    sourceLocale: { type: 'string', description: 'Source locale code/language/file', required: true },
    sourceValue: { type: 'string', description: 'Optional source value to write before translating' },
    targets: { type: 'string', description: 'Comma-separated target locales, or "all"/omitted for all except source' },
    overwrite: { type: 'boolean', description: 'Overwrite existing target translations (default true)', default: true },
    dryRun: { type: 'boolean', description: 'Preview without writing or translating', default: false },
    includePreview: { type: 'boolean', description: 'Include translated values in output', default: false },
    ...providerArgs,
  },
  async run(args) {
    const targetLocales = args.targets === 'all' ? 'all' : splitList(args.targets)

    const translateFn = await resolveProviderTranslateFn(args)

    const result = await translateKey({
      layer: args.layer,
      key: args.key,
      sourceLocale: args.sourceLocale,
      sourceValue: args.sourceValue,
      targetLocales,
      overwrite: args.overwrite,
      dryRun: args.dryRun,
      includePreview: args.includePreview,
      projectDir: args.projectDir,
      translateFn,
    })

    // CLI-owned guidance: agent mode here just means no provider was given
    if (result.mode === 'agent' && result.skipped.some(s => s.reason === 'no-provider')) {
      result.message = 'No provider configured — nothing was translated. Pass --provider and --model '
        + '(API key via --apiKey or the OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env vars) '
        + 'to translate automatically.'
    }
    return result
  },
})
