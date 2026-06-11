import { defineCommand } from 'citty'
import { translateKey } from '../core/operations.js'
import { createSamplingFn } from '../llm/providers.js'
import type { SamplingFn } from '../core/types.js'
import type { LlmProvider } from '../llm/providers.js'
import { sharedArgs, outputResult, splitList } from './_shared.js'

export default defineCommand({
  meta: {
    name: 'translate-key',
    description: 'Translate a single key from a source locale into target locales. Supports LLM translation with --provider.',
  },
  args: {
    ...sharedArgs,
    layer: {
      type: 'string',
      description: 'Layer name',
      required: true,
    },
    key: {
      type: 'string',
      description: 'Dot-separated translation key',
      required: true,
    },
    sourceLocale: {
      type: 'string',
      description: 'Source locale code/language/file',
      required: true,
    },
    sourceValue: {
      type: 'string',
      description: 'Optional source value to write before translating',
    },
    targets: {
      type: 'string',
      description: 'Comma-separated target locales, or "all"/omitted for all except source',
    },
    overwrite: {
      type: 'boolean',
      description: 'Overwrite existing target translations (default true)',
      default: true,
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview without writing or sampling',
      default: false,
    },
    includePreview: {
      type: 'boolean',
      description: 'Include translated values in output',
      default: false,
    },
    provider: {
      type: 'string' as const,
      description: 'LLM provider: "openai" or "anthropic". Without this, only returns fallback context.',
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
  },
  async run({ args }) {
    const targetLocales = args.targets === 'all'
      ? 'all'
      : splitList(args.targets)

    let samplingFn: SamplingFn | undefined
    if (args.provider) {
      if (!args.model) {
        throw new Error('--model is required when --provider is set')
      }
      samplingFn = await createSamplingFn({
        provider: args.provider as LlmProvider,
        model: args.model,
        apiKey: args.apiKey,
      })
    }

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
      samplingFn,
    })
    outputResult(result, args)
  },
})
