import type { SamplingFn, SamplingRequest, SamplingResponse } from '../core/types.js'

export type LlmProvider = 'openai' | 'anthropic'

export interface LlmProviderConfig {
  provider: LlmProvider
  model: string
  /** Override API key. Falls back to env vars */
  apiKey?: string
  /** Base URL override for proxies / compatible APIs */
  baseUrl?: string
}

function resolveApiKey(provider: LlmProvider, configKey?: string): string {
  if (configKey) return configKey
  const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'
  const key = process.env[envKey]
  if (!key) {
    throw new Error(
      `No API key found for provider "${provider}". Set ${envKey} environment variable or pass apiKey in config.`,
    )
  }
  return key
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional peer dep
async function createOpenAiSamplingFn(config: LlmProviderConfig): Promise<SamplingFn> {
  let OpenAI: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import
    OpenAI = (await import('openai')).default as any
  } catch {
    throw new Error(
      'Provider "openai" requires the "openai" package. Install it with:\n  npm install openai\n  pnpm add openai\n  yarn add openai',
    )
  }

  const apiKey = resolveApiKey('openai', config.apiKey)
  const client = new OpenAI({ apiKey, baseURL: config.baseUrl })

  return async (opts: SamplingRequest): Promise<SamplingResponse> => {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userMessage },
      ],
      // eslint-disable-next-line camelcase
      max_tokens: opts.maxTokens,
      temperature: 0,
      // eslint-disable-next-line camelcase
      response_format: { type: 'json_object' },
    })

    const text = response.choices[0]?.message?.content ?? ''
    return { text, model: response.model || config.model }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional peer dep
async function createAnthropicSamplingFn(config: LlmProviderConfig): Promise<SamplingFn> {
  let Anthropic: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import
    Anthropic = (await import('@anthropic-ai/sdk')).Anthropic as any
  } catch {
    throw new Error(
      'Provider "anthropic" requires the "@anthropic-ai/sdk" package. Install it with:\n  npm install @anthropic-ai/sdk\n  pnpm add @anthropic-ai/sdk\n  yarn add @anthropic-ai/sdk',
    )
  }

  const apiKey = resolveApiKey('anthropic', config.apiKey)
  const client = new Anthropic({ apiKey, baseURL: config.baseUrl })

  return async (opts: SamplingRequest): Promise<SamplingResponse> => {
    const response = await client.messages.create({
      model: config.model,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userMessage }],
      // eslint-disable-next-line camelcase
      max_tokens: opts.maxTokens,
      temperature: 0,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types not available
    const textBlock = response.content.find((block: any) => block.type === 'text')
    const text = textBlock?.text ?? ''
    return { text, model: response.model || config.model }
  }
}

/**
 * Create a SamplingFn from an LLM provider config.
 * Throws if the provider SDK is not installed or API key is missing.
 */
export async function createSamplingFn(config: LlmProviderConfig): Promise<SamplingFn> {
  switch (config.provider) {
    case 'openai':
      return createOpenAiSamplingFn(config)
    case 'anthropic':
      return createAnthropicSamplingFn(config)
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
