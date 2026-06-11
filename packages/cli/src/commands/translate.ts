import { defineCommand } from 'citty'
import { createSamplingFn } from '../llm/providers.js'
import type { SamplingFn } from '../core/types.js'
import type { LlmProvider } from '../llm/providers.js'
import { translateMissing } from '../core/operations.js'
import { sharedArgs, outputResult, splitList } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'translate',
    description: 'Find missing translations and translate them via LLM. Requires --provider and --model for auto-translation.',
  },
  args: {
    ...sharedArgs,
    layer: {
      type: 'string',
      description: 'Layer name',
      required: true,
    },
    ref: {
      type: 'string',
      description: 'Reference locale (default: project default)',
    },
    targets: {
      type: 'string',
      description: 'Comma-separated target locales (default: all except ref)',
    },
    keys: {
      type: 'string',
      description: 'Comma-separated keys to translate (default: all missing)',
    },
    batchSize: {
      type: 'string',
      description: 'Batch size (default: 50)',
    },
    provider: {
      type: 'string' as const,
      description: 'LLM provider: "openai" or "anthropic". Without this, only returns fallback contexts.',
      valueHint: 'openai|anthropic',
    },
    model: {
      type: 'string' as const,
      description: 'Model name (required when --provider is set)',
    },
    apiKey: {
      type: 'string' as const,
      description: 'API key (falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY env)',
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview what would be translated',
      default: false,
    },
  },
  async run({ args }) {
    let batchSize: number | undefined
    if (args.batchSize) {
      const raw = args.batchSize
      const num = Number(raw)
      if (!Number.isInteger(num) || num <= 0 || String(num) !== raw) {
        throw new Error(`Invalid --batchSize: "${raw}". Must be a positive integer`)
      }
      batchSize = num
    }

    let samplingFn: SamplingFn | undefined
    if (args.provider) {
      if (!args.model) {
        throw new Error('--model is required when --provider is set')
      }
      if (args.provider !== 'openai' && args.provider !== 'anthropic') {
        throw new Error(`Unknown provider: "${args.provider}". Must be "openai" or "anthropic".`)
      }
      samplingFn = await createSamplingFn({
        provider: args.provider as LlmProvider,
        model: args.model,
        apiKey: args.apiKey,
      })
    }

    const result = await translateMissing({
      layer: args.layer,
      referenceLocale: args.ref,
      targetLocales: splitList(args.targets),
      keys: splitList(args.keys),
      batchSize,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      samplingFn,
    })
    outputResult(result, args)
  },
})
