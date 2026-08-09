import { describe, it, expect } from 'vitest'
import { isTotalFailure } from '../../src/commands/_shared.js'

/**
 * Unit tests for the CI exit-code decision: a completed run exits non-zero
 * only when it achieved nothing (failures present, zero successes).
 */

describe('isTotalFailure', () => {
  it('flags a translate-missing result where everything failed', () => {
    expect(isTotalFailure({
      results: {},
      summary: { totalTranslated: 0, totalFailed: 4, totalSkipped: 0 },
    })).toBe(true)
  })

  it('accepts partial success (some translated, some failed)', () => {
    expect(isTotalFailure({
      summary: { totalTranslated: 3, totalFailed: 1, totalSkipped: 0 },
    })).toBe(false)
  })

  it('accepts full success and no-op runs', () => {
    expect(isTotalFailure({ summary: { totalTranslated: 8, totalFailed: 0, totalSkipped: 0 } })).toBe(false)
    expect(isTotalFailure({ summary: { totalTranslated: 0, totalFailed: 0, totalSkipped: 0 } })).toBe(false)
  })

  it('flags a translate-key result where everything failed', () => {
    expect(isTotalFailure({
      key: 'a.b',
      translated: [],
      failed: [{ locale: 'en', reason: 'provider-error' }],
    })).toBe(true)
  })

  it('accepts a translate-key result with any success', () => {
    expect(isTotalFailure({
      key: 'a.b',
      translated: ['fr'],
      failed: [{ locale: 'en', reason: 'provider-error' }],
    })).toBe(false)
    expect(isTotalFailure({ key: 'a.b', translated: [], failed: [] })).toBe(false)
  })

  it('ignores results without translate summary fields (unrelated commands)', () => {
    expect(isTotalFailure({ summary: { totalMissingKeys: 12 } })).toBe(false)
    expect(isTotalFailure({ matches: [], totalMatches: 0 })).toBe(false)
    expect(isTotalFailure({ summary: 'text' })).toBe(false)
    expect(isTotalFailure(null)).toBe(false)
    expect(isTotalFailure(undefined)).toBe(false)
    expect(isTotalFailure('string')).toBe(false)
    expect(isTotalFailure([])).toBe(false)
  })

  it('requires both counters to be numbers before deciding', () => {
    expect(isTotalFailure({ summary: { totalFailed: 4 } })).toBe(false)
    expect(isTotalFailure({ summary: { totalFailed: '4', totalTranslated: '0' } })).toBe(false)
  })
})
