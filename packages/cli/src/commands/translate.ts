import { createCommand, splitList } from './_shared.js'
import { createTranslateFn } from '../llm/providers.js'
import type { TranslateFn } from '../core/types.js'
import type { LlmProvider } from '../llm/providers.js'
import { translateMissing } from '../core/operations.js'

export default createCommand({
  name: 'translate',
  description: 'Find missing translations and translate them via LLM. Requires --provider and --model for auto-translation.',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    ref: { type: 'string', description: 'Reference locale (default: project default)' },
    targets: { type: 'string', description: 'Comma-separated target locales (default: all except ref)' },
    keys: { type: 'string', description: 'Comma-separated keys to translate (default: all missing)' },
    batchSize: { type: 'string', description: 'Batch size (default: 50)' },
    provider: { type: 'string' as const, description: 'LLM provider: "openai", "anthropic", or "google". Without this, only returns fallback contexts.', valueHint: 'openai|anthropic|google' },
    model: { type: 'string' as const, description: 'Model name (required when --provider is set)' },
    apiKey: { type: 'string' as const, description: 'API key (falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env).' },
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

    let translateFn: TranslateFn | undefined
    if (args.provider) {
      if (!args.model) {
        throw new Error('--model is required when --provider is set')
      }
      translateFn = await createTranslateFn({
        provider: args.provider as LlmProvider,
        model: args.model,
        apiKey: args.apiKey,
      })
    }

    return translateMissing({
      layer: args.layer,
      referenceLocale: args.ref,
      targetLocales: splitList(args.targets),
      keys: splitList(args.keys),
      batchSize,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      translateFn,
    })
  },
})
