import { createCommand, splitList, providerArgs, resolveProviderTranslateFn } from './_shared.js'
import { translateMissing } from '../core/operations.js'

export default createCommand({
  name: 'translate',
  description: 'Find missing translations and translate them via LLM. Requires --provider and --model for auto-translation.',
  args: {
    layer: { type: 'string', description: 'Layer name (default: all locale-backed layers, aggregated)' },
    ref: { type: 'string', description: 'Reference locale (default: project default)' },
    targets: { type: 'string', description: 'Comma-separated target locales (default: all except ref)' },
    keys: { type: 'string', description: 'Comma-separated keys to translate (default: all missing)' },
    batchSize: { type: 'string', description: 'Batch size (default: 50)' },
    ...providerArgs,
    dryRun: { type: 'boolean', description: 'Preview what would be translated', default: false },
  },
  async run(args) {
    let batchSize: number | undefined
    if (args.batchSize) {
      const num = Number(args.batchSize)
      if (!Number.isInteger(num) || num <= 0 || String(num) !== args.batchSize) {
        throw new Error(`Invalid --batchSize: "${args.batchSize}". Must be a positive integer`)
      }
      batchSize = num
    }

    const translateFn = await resolveProviderTranslateFn(args)

    const result = await translateMissing({
      layer: args.layer,
      referenceLocale: args.ref,
      targetLocales: splitList(args.targets),
      keys: splitList(args.keys),
      batchSize,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      translateFn,
    })

    // CLI-owned guidance: agent mode here just means no provider was given
    const summary = result.summary as Record<string, unknown> | undefined
    if (summary?.mode === 'agent') {
      summary.message = 'No provider configured — nothing was translated. Pass --provider and --model '
        + '(API key via --apiKey or the OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env vars) '
        + 'to translate automatically.'
    }
    return result
  },
})
