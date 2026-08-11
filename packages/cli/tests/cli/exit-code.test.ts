import { describe, it, expect } from 'vitest'
import {
  isTotalFailure,
  resolveExitCode,
  EXIT_SUCCESS,
  EXIT_RUN_FAILED,
  EXIT_GATE_TRIPPED,
} from '../../src/commands/_shared.js'
import type { RequestedGate } from '../../src/commands/_shared.js'

/**
 * Unit tests for the CI exit-code decision: a completed run exits non-zero
 * only when it achieved nothing (failures present, zero successes), or when
 * an opt-in gate the caller requested tripped (#248).
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

describe('resolveExitCode', () => {
  const missingGate: RequestedGate = {
    name: 'fail-on-missing',
    counter: 'totalMissingKeys',
    direction: 'above',
    threshold: 0,
  }
  const orphanGate: RequestedGate = {
    name: 'fail-on-orphans',
    counter: 'orphanCount',
    direction: 'above',
    threshold: 0,
  }

  describe('without gates — today\'s behaviour, unchanged', () => {
    it('exits 0 for a clean run', () => {
      expect(resolveExitCode({ summary: { totalMissingKeys: 12 } }, []))
        .toEqual({ code: EXIT_SUCCESS, tripped: [] })
    })

    it('exits 1 when the run itself failed', () => {
      expect(resolveExitCode({ summary: {} }, [], true))
        .toEqual({ code: EXIT_RUN_FAILED, tripped: [] })
    })

    it('never trips on findings the caller did not gate on', () => {
      expect(resolveExitCode({ summary: { totalMissingKeys: 999, orphanCount: 999 } }, []).code)
        .toBe(EXIT_SUCCESS)
    })
  })

  describe('gate evaluation', () => {
    it('exits 2 when the observed count is above the threshold', () => {
      const decision = resolveExitCode({ summary: { totalMissingKeys: 12 } }, [missingGate])
      expect(decision.code).toBe(EXIT_GATE_TRIPPED)
      expect(decision.tripped).toEqual([{ ...missingGate, observed: 12 }])
    })

    it('exits 0 when the observed count sits at the threshold', () => {
      expect(resolveExitCode({ summary: { totalMissingKeys: 0 } }, [missingGate]).code)
        .toBe(EXIT_SUCCESS)
    })

    it('works on the reportFile shape, which carries only the summary', () => {
      expect(resolveExitCode({ reportFile: '/tmp/r.json', summary: { orphanCount: 3 } }, [orphanGate]).code)
        .toBe(EXIT_GATE_TRIPPED)
    })

    it('supports a below-threshold direction for coverage-style gates', () => {
      const coverage: RequestedGate = {
        name: 'fail-under',
        counter: 'completionPercent',
        direction: 'below',
        threshold: 90,
      }
      expect(resolveExitCode({ summary: { completionPercent: 84 } }, [coverage]).code)
        .toBe(EXIT_GATE_TRIPPED)
      expect(resolveExitCode({ summary: { completionPercent: 90 } }, [coverage]).code)
        .toBe(EXIT_SUCCESS)
      expect(resolveExitCode({ summary: { completionPercent: 97 } }, [coverage]).code)
        .toBe(EXIT_SUCCESS)
    })
  })

  describe('a failed run outranks a tripped gate', () => {
    it('reports exit 1, not exit 2, when both would apply', () => {
      const decision = resolveExitCode({ summary: { totalMissingKeys: 12 } }, [missingGate], true)
      expect(decision.code).toBe(EXIT_RUN_FAILED)
    })

    it('reports no tripped gates, since counters from a failed run mean nothing', () => {
      expect(resolveExitCode({ summary: { totalMissingKeys: 12 } }, [missingGate], true).tripped)
        .toEqual([])
    })
  })

  describe('composition', () => {
    it('evaluates several gates on one invocation', () => {
      const decision = resolveExitCode(
        { summary: { totalMissingKeys: 4, orphanCount: 7 } },
        [missingGate, orphanGate],
      )
      expect(decision.code).toBe(EXIT_GATE_TRIPPED)
      expect(decision.tripped.map(g => g.name)).toEqual(['fail-on-missing', 'fail-on-orphans'])
    })

    it('trips on one gate while the other stays clean', () => {
      const decision = resolveExitCode(
        { summary: { totalMissingKeys: 0, orphanCount: 7 } },
        [missingGate, orphanGate],
      )
      expect(decision.code).toBe(EXIT_GATE_TRIPPED)
      expect(decision.tripped.map(g => g.name)).toEqual(['fail-on-orphans'])
    })
  })

  describe('results lacking the counter never trip a gate', () => {
    it.each([
      ['a summary without the counter', { summary: { totalKeys: 40 } }],
      ['a non-numeric counter', { summary: { totalMissingKeys: '12' } }],
      ['a NaN counter', { summary: { totalMissingKeys: Number.NaN } }],
      ['a non-object summary', { summary: 'text' }],
      ['no summary at all', { missing: {} }],
      ['null', null],
      ['a primitive', 'string'],
      ['an array', []],
    ])('%s', (_label, result) => {
      expect(resolveExitCode(result, [missingGate, orphanGate]))
        .toEqual({ code: EXIT_SUCCESS, tripped: [] })
    })
  })
})
