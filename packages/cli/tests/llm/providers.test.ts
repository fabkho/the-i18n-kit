import { describe, it, expect } from 'vitest'
import {
  TranslateProviderError,
  classifyProviderError,
  resolveProviderBaseUrl,
  createTranslateFn,
} from '../../src/llm/providers.js'
import { redactBaseUrl } from '../../src/commands/_shared.js'

/**
 * Unit tests for the provider error classification mapping. No SDKs are
 * imported — classifyProviderError only inspects plain error shapes.
 */

function errWithStatus(status: number): Error {
  const error = new Error(`HTTP ${status}`)
  ;(error as Error & { status: number }).status = status
  return error
}

describe('classifyProviderError', () => {
  it('classifies 401 as auth', () => {
    const classified = classifyProviderError(errWithStatus(401))
    expect(classified).toBeInstanceOf(TranslateProviderError)
    expect(classified.kind).toBe('auth')
    expect(classified.status).toBe(401)
    expect(classified.message).toBe('HTTP 401')
  })

  it('classifies 403 as auth', () => {
    expect(classifyProviderError(errWithStatus(403)).kind).toBe('auth')
  })

  it('classifies 429 as rate-limit', () => {
    expect(classifyProviderError(errWithStatus(429)).kind).toBe('rate-limit')
  })

  it('classifies other status codes as provider', () => {
    expect(classifyProviderError(errWithStatus(500)).kind).toBe('provider')
    expect(classifyProviderError(errWithStatus(400)).kind).toBe('provider')
  })

  it('classifies errors without a status as provider', () => {
    const classified = classifyProviderError(new Error('socket hang up'))
    expect(classified.kind).toBe('provider')
    expect(classified.status).toBeUndefined()
    expect(classified.message).toBe('socket hang up')
  })

  it('reads a nested response.status defensively', () => {
    const error = new Error('unauthorized') as Error & { response: { status: number } }
    error.response = { status: 401 }
    expect(classifyProviderError(error).kind).toBe('auth')
  })

  it('prefers a top-level status over response.status', () => {
    const error = new Error('rate limited') as Error & { status: number, response: { status: number } }
    error.status = 429
    error.response = { status: 500 }
    expect(classifyProviderError(error).kind).toBe('rate-limit')
  })

  it('handles non-Error and malformed shapes without throwing', () => {
    expect(classifyProviderError('boom').kind).toBe('provider')
    expect(classifyProviderError('boom').message).toBe('boom')
    expect(classifyProviderError(null).kind).toBe('provider')
    expect(classifyProviderError({ status: 'not-a-number', response: 42 }).kind).toBe('provider')
  })

  it('passes an already-classified error through unchanged', () => {
    const original = new TranslateProviderError('key invalid', 'auth')
    expect(classifyProviderError(original)).toBe(original)
  })
})

/**
 * Base URL resolution is a pure precedence decision over three sources, so it
 * is unit-tested without touching the SDKs or the filesystem.
 */
describe('resolveProviderBaseUrl', () => {
  it('prefers the flag over env and config', () => {
    expect(resolveProviderBaseUrl({
      flag: 'https://flag.example',
      env: 'https://env.example',
      config: 'https://config.example',
    })).toBe('https://flag.example')
  })

  it('falls back to env when no flag is given', () => {
    expect(resolveProviderBaseUrl({
      env: 'https://env.example',
      config: 'https://config.example',
    })).toBe('https://env.example')
  })

  it('falls back to config when neither flag nor env is given', () => {
    expect(resolveProviderBaseUrl({ config: 'https://config.example' })).toBe('https://config.example')
  })

  it('returns undefined when every source is unset', () => {
    expect(resolveProviderBaseUrl({})).toBeUndefined()
  })

  it('treats blank values as unset so an empty override cannot mask a real one', () => {
    expect(resolveProviderBaseUrl({ flag: '', env: '   ', config: 'https://config.example' }))
      .toBe('https://config.example')
    expect(resolveProviderBaseUrl({ flag: '  ' })).toBeUndefined()
  })

  it('trims the resolved value', () => {
    expect(resolveProviderBaseUrl({ flag: '  https://flag.example  ' })).toBe('https://flag.example')
  })
})

describe('redactBaseUrl', () => {
  it('keeps origin and path for a plain URL', () => {
    expect(redactBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1')
  })

  it('removes user-info credentials', () => {
    expect(redactBaseUrl('https://user:secret@gateway.example/v1'))
      .toBe('https://<redacted>@gateway.example/v1')
  })

  it('removes a query string that could carry a key', () => {
    const redacted = redactBaseUrl('https://gateway.example/v1?api-key=secret')
    expect(redacted).not.toContain('secret')
    expect(redacted).toBe('https://gateway.example/v1 (query redacted)')
  })

  it('removes a fragment', () => {
    expect(redactBaseUrl('https://gateway.example/v1#token')).not.toContain('token')
  })

  it('keeps a non-default port, which is diagnostic rather than secret', () => {
    expect(redactBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
  })

  it('never echoes an unparseable value', () => {
    expect(redactBaseUrl('not a url')).toBe('<unparseable base URL>')
  })
})

describe('createTranslateFn base URL support', () => {
  it('rejects a base URL for google rather than silently ignoring it', async () => {
    await expect(createTranslateFn({
      provider: 'google',
      model: 'gemini-2.0-flash',
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example',
    })).rejects.toMatchObject({
      name: 'TranslateProviderError',
      kind: 'config',
    })
  })

  it('names the three ways a base URL could have been set', async () => {
    await expect(createTranslateFn({
      provider: 'google',
      model: 'gemini-2.0-flash',
      apiKey: 'test-key',
      baseUrl: 'https://proxy.example',
    })).rejects.toThrow(/--baseUrl \/ I18N_BASE_URL \/ providerBaseUrl/)
  })
})
