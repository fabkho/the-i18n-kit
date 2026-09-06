/**
 * The translation backend, resolved once at startup from the environment.
 *
 * Fully configured (`I18N_PROVIDER`, `I18N_MODEL`, and the provider's API key
 * env) → provider mode: the translating tools call the LLM provider directly.
 * Nothing configured → agent mode: they return fallback contexts for the host
 * agent to translate inline and persist via write_translations.
 * Partial configuration → a startup warning on stderr plus agent mode, so a
 * misconfigured server never surprises callers per-request.
 */

import {
  BASE_URL_ENV,
  createTranslateFn,
  loadProjectConfig,
  resolveProviderBaseUrl,
  toErrorMessage,
} from '@the-i18n-kit/cli'
import type { LlmProvider, TranslateFn } from '@the-i18n-kit/cli'

const PROVIDER_KEY_ENVS: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
}

export interface TranslationBackend {
  mode: 'provider' | 'agent'
  provider?: LlmProvider
  model?: string
  translateFn?: TranslateFn
}

function isKnownProvider(value: string): value is LlmProvider {
  return value in PROVIDER_KEY_ENVS
}

export async function resolveTranslationBackend(projectDir: string): Promise<TranslationBackend> {
  const provider = process.env.I18N_PROVIDER
  const model = process.env.I18N_MODEL

  if (!provider && !model) return { mode: 'agent' }

  const warn = (message: string) => process.stderr.write(`[the-i18n-mcp] ${message}\n`)

  if (!provider) {
    warn('Partial provider config: I18N_MODEL is set but I18N_PROVIDER is missing. Running in agent mode.')
    return { mode: 'agent' }
  }
  if (!isKnownProvider(provider)) {
    warn(`Partial provider config: I18N_PROVIDER="${provider}" is not one of openai | anthropic | google. Running in agent mode.`)
    return { mode: 'agent' }
  }
  if (!model) {
    warn(`Partial provider config: I18N_PROVIDER=${provider} is set but I18N_MODEL is missing. Running in agent mode.`)
    return { mode: 'agent' }
  }
  const keyEnv = PROVIDER_KEY_ENVS[provider]
  if (!process.env[keyEnv]) {
    warn(`Partial provider config: I18N_PROVIDER=${provider} is set but ${keyEnv} is missing. Running in agent mode.`)
    return { mode: 'agent' }
  }

  try {
    const translateFn = await createTranslateFn({
      provider,
      model,
      baseUrl: await resolveStartupBaseUrl(projectDir),
    })
    return { mode: 'provider', provider, model, translateFn }
  }
  catch (error) {
    warn(`Provider setup failed: ${toErrorMessage(error)}. Running in agent mode.`)
    return { mode: 'agent' }
  }
}

/**
 * Base URL for the startup-resolved backend: I18N_BASE_URL, else the project
 * config's providerBaseUrl. A missing or unreadable config is not fatal here
 * — the server still starts, just without an endpoint override.
 */
async function resolveStartupBaseUrl(projectDir: string): Promise<string | undefined> {
  const fromEnv = resolveProviderBaseUrl({ env: process.env[BASE_URL_ENV] })
  if (fromEnv) return fromEnv
  try {
    const projectConfig = await loadProjectConfig(projectDir)
    return resolveProviderBaseUrl({ config: projectConfig?.providerBaseUrl })
  }
  catch {
    return undefined
  }
}
