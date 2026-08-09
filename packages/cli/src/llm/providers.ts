import type { TranslateFn, TranslateRequest, TranslateResponse } from '../core/types.js'

export type LlmProvider = 'openai' | 'anthropic' | 'google'

// ─── Error classification ───────────────────────────────────────

/** How a provider failure should be handled by the caller. */
export type TranslateProviderErrorKind = 'auth' | 'rate-limit' | 'provider'

/**
 * A classified provider failure. `auth` errors are not retryable (the caller
 * should abort the run), `rate-limit` errors should be retried with backoff,
 * and `provider` covers everything else (server errors, network, …).
 */
export class TranslateProviderError extends Error {
  public readonly kind: TranslateProviderErrorKind
  public readonly status?: number

  constructor(message: string, kind: TranslateProviderErrorKind, status?: number) {
    super(message)
    this.name = 'TranslateProviderError'
    this.kind = kind
    this.status = status
  }
}

/** Defensively extract an HTTP status code from an unknown SDK error shape. */
function extractStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const e = error as { status?: unknown, response?: unknown }
  if (typeof e.status === 'number') return e.status
  if (e.response !== null && typeof e.response === 'object') {
    const status = (e.response as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

/**
 * Classify an SDK error into a TranslateProviderError:
 * 401/403 → auth, 429 → rate-limit, anything else → provider.
 * Already-classified errors pass through unchanged.
 */
export function classifyProviderError(error: unknown): TranslateProviderError {
  if (error instanceof TranslateProviderError) return error
  const status = extractStatus(error)
  const message = error instanceof Error ? error.message : String(error)
  const kind: TranslateProviderErrorKind
    = status === 401 || status === 403 ? 'auth'
      : status === 429 ? 'rate-limit'
        : 'provider'
  return new TranslateProviderError(message, kind, status)
}

export interface LlmProviderConfig {
  provider: LlmProvider
  model: string
  /** Override API key. Falls back to env vars */
  apiKey?: string
  /** Base URL override for proxies / compatible APIs */
  baseUrl?: string
}

const ENV_KEY_MAP: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
}

function resolveApiKey(provider: LlmProvider, configKey?: string): string {
  if (configKey) return configKey
  const envKey = ENV_KEY_MAP[provider]
  const key = process.env[envKey]
  if (!key) {
    throw new Error(
      `No API key found for provider "${provider}". Set ${envKey} environment variable or pass apiKey in config.`,
    )
  }
  return key
}

async function createOpenAiTranslateFn(config: LlmProviderConfig): Promise<TranslateFn> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional peer dep
  let OpenAI: any
  try {
    OpenAI = (await import('openai')).default as any // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    throw new Error(
      'Provider "openai" requires the "openai" package. Install it with:\n  npm install openai\n  pnpm add openai\n  yarn add openai',
    )
  }

  const apiKey = resolveApiKey('openai', config.apiKey)
  const client = new OpenAI({ apiKey, baseURL: config.baseUrl })

  return async (opts: TranslateRequest): Promise<TranslateResponse> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types not available
    let response: any
    try {
      response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userMessage },
        ],
        max_tokens: opts.maxTokens,
        temperature: 0,
        response_format: { type: 'json_object' },
      })
    } catch (error) {
      throw classifyProviderError(error)
    }

    const choice = response.choices?.[0]
    const text = choice?.message?.content ?? ''
    const truncated = choice?.finish_reason === 'length'
    return { text, model: response.model || config.model, ...(truncated ? { truncated: true } : {}) }
  }
}

async function createGoogleTranslateFn(config: LlmProviderConfig): Promise<TranslateFn> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional peer dep
  let GoogleGenAI: any
  try {
    GoogleGenAI = (await import('@google/genai')).GoogleGenAI as any // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    throw new Error(
      'Provider "google" requires the "@google/genai" package. Install it with:\n  npm install @google/genai\n  pnpm add @google/genai\n  yarn add @google/genai',
    )
  }

  const apiKey = resolveApiKey('google', config.apiKey)
  const client = new GoogleGenAI({ apiKey })

  return async (opts: TranslateRequest): Promise<TranslateResponse> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types not available
    let response: any
    try {
      response = await client.models.generateContent({
        model: config.model,
        contents: opts.userMessage,
        config: {
          systemInstruction: opts.systemPrompt,
          maxOutputTokens: opts.maxTokens,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      })
    } catch (error) {
      throw classifyProviderError(error)
    }

    const text = response.text ?? ''
    const truncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS'
    return { text, model: response.modelVersion || config.model, ...(truncated ? { truncated: true } : {}) }
  }
}

async function createAnthropicTranslateFn(config: LlmProviderConfig): Promise<TranslateFn> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional peer dep
  let Anthropic: any
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).Anthropic as any // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    throw new Error(
      'Provider "anthropic" requires the "@anthropic-ai/sdk" package. Install it with:\n  npm install @anthropic-ai/sdk\n  pnpm add @anthropic-ai/sdk\n  yarn add @anthropic-ai/sdk',
    )
  }

  const apiKey = resolveApiKey('anthropic', config.apiKey)
  const client = new Anthropic({ apiKey, baseURL: config.baseUrl })

  return async (opts: TranslateRequest): Promise<TranslateResponse> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types not available
    let response: any
    try {
      response = await client.messages.create({
        model: config.model,
        system: opts.systemPrompt,
        messages: [{ role: 'user', content: opts.userMessage }],
        max_tokens: opts.maxTokens,
        temperature: 0,
      })
    } catch (error) {
      throw classifyProviderError(error)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types not available
    const textBlock = response.content?.find((block: any) => block.type === 'text')
    const text = textBlock?.text ?? ''
    const truncated = response.stop_reason === 'max_tokens'
    return { text, model: response.model || config.model, ...(truncated ? { truncated: true } : {}) }
  }
}

/**
 * Create a TranslateFn from an LLM provider config.
 * Throws if the provider SDK is not installed or API key is missing.
 */
export async function createTranslateFn(config: LlmProviderConfig): Promise<TranslateFn> {
  switch (config.provider) {
    case 'openai':
      return createOpenAiTranslateFn(config)
    case 'anthropic':
      return createAnthropicTranslateFn(config)
    case 'google':
      return createGoogleTranslateFn(config)
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}
