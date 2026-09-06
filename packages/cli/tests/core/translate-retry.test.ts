import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestWithRetry } from '../../src/core/translate/retry.js'
import type { TranslateRunState } from '../../src/core/translate/retry.js'
import type { TranslateFn, TranslateRequest } from '../../src/core/types.js'
import { TranslateProviderError } from '../../src/llm/providers.js'
import { ToolError } from '../../src/utils/errors.js'

/**
 * Unit contract of the request loop shared by translate_missing and
 * translate_key. The seam tests cover it end to end; these pin the outcome
 * mapping and the two fail-fast cases without waiting out the real backoff.
 */

const req: TranslateRequest = { systemPrompt: 'sys', userMessage: 'user', maxTokens: 16384 }

/** Drive a run to completion with the backoff timers fast-forwarded. */
async function runWithFakeTimers<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers()
  const pending = start()
  await vi.runAllTimersAsync()
  return pending
}

afterEach(() => {
  vi.useRealTimers()
})

describe('requestWithRetry', () => {
  it('returns the parsed value of a first successful attempt', async () => {
    const translateFn: TranslateFn = async () => ({ text: '{"greeting":"Hi"}', model: 'fake-model' })

    const outcome = await requestWithRetry(translateFn, req, {
      label: 'en',
      parse: text => JSON.parse(text) as Record<string, string>,
    })

    expect(outcome).toEqual({ status: 'ok', value: { greeting: 'Hi' }, model: 'fake-model' })
  })

  it('retries once after a provider error and reports the retry result', async () => {
    let calls = 0
    const translateFn: TranslateFn = async () => {
      calls++
      if (calls === 1) throw new TranslateProviderError('Rate limit exceeded', 'rate-limit', 429)
      return { text: '"ok"', model: 'fake-model' }
    }

    const outcome = await runWithFakeTimers(() => requestWithRetry(translateFn, req, {
      label: 'en',
      parse: text => JSON.parse(text) as string,
    }))

    expect(calls).toBe(2)
    expect(outcome).toEqual({ status: 'ok', value: 'ok', model: 'fake-model' })
  })

  it('gives up after the retry and keeps the last observed model', async () => {
    let calls = 0
    const translateFn: TranslateFn = async () => {
      calls++
      return { text: 'not json', model: 'fake-model' }
    }

    const outcome = await runWithFakeTimers(() => requestWithRetry(translateFn, req, {
      label: 'en',
      parse: text => JSON.parse(text) as string,
    }))

    expect(calls).toBe(2)
    expect(outcome).toEqual({ status: 'failed', model: 'fake-model' })
  })

  it('treats an empty response as a retryable provider error', async () => {
    let calls = 0
    const translateFn: TranslateFn = async () => {
      calls++
      return { text: '   ', model: 'fake-model' }
    }

    const outcome = await runWithFakeTimers(() => requestWithRetry(translateFn, req, {
      label: 'en',
      parse: () => 'never',
    }))

    expect(calls).toBe(2)
    expect(outcome.status).toBe('failed')
  })

  it('does not retry a truncated response', async () => {
    let calls = 0
    const translateFn: TranslateFn = async () => {
      calls++
      return { text: '{"greeting": "Hel', model: 'fake-model', truncated: true }
    }

    const outcome = await requestWithRetry(translateFn, req, {
      label: 'en',
      parse: () => 'never',
    })

    expect(calls).toBe(1)
    expect(outcome).toEqual({ status: 'truncated', model: 'fake-model' })
  })

  it('does not retry an auth failure and aborts the run', async () => {
    let calls = 0
    const runState: TranslateRunState = { aborted: false }
    const translateFn: TranslateFn = async () => {
      calls++
      throw new TranslateProviderError('Incorrect API key provided', 'auth')
    }

    const error = await requestWithRetry(translateFn, req, {
      label: 'en',
      parse: () => 'never',
      runState,
    }).then(() => null, (e: unknown) => e)

    expect(calls).toBe(1)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as ToolError).code).toBe('PROVIDER_AUTH_ERROR')
    expect((error as ToolError).message).toContain('Incorrect API key provided')
    expect(runState.aborted).toBe(true)
  })

  it('issues no request once a sibling aborted the run', async () => {
    let calls = 0
    const translateFn: TranslateFn = async () => {
      calls++
      return { text: '"ok"', model: 'fake-model' }
    }

    const outcome = await requestWithRetry(translateFn, req, {
      label: 'en',
      parse: () => 'never',
      runState: { aborted: true },
    })

    expect(calls).toBe(0)
    expect(outcome).toEqual({ status: 'failed', model: undefined })
  })
})
