import { describe, it, expect } from 'vitest'
import { TranslateProviderError, classifyProviderError } from '../../src/llm/providers.js'

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
