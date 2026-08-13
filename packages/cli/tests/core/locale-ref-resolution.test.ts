import { describe, it, expect } from 'vitest'
import { resolveLocaleRef, findLocaleImpl, findLocaleSuggestion } from '../../src/core/shared.js'
import type { I18nConfig } from '../../src/config/types.js'

/**
 * Locale-ref resolution (#301). The real-world shape this guards against is
 * anny-ui's, where two locales share a language tag:
 *
 *   code=de         language=de-DE  file=de-DE.json
 *   code=de-formal  language=de-DE  file=de-DE-formal.json
 *
 * so "de-DE" matches two locales and "de-DE-formal" matches none — it is not a
 * code, not a language tag, and the file carries a .json extension.
 */
const config = {
  locales: [
    { code: 'de', language: 'de-DE', file: 'de-DE.json' },
    { code: 'de-formal', language: 'de-DE', file: 'de-DE-formal.json' },
    { code: 'en', language: 'en-GB', file: 'en-GB.json' },
    { code: 'en-us', language: 'en-US', file: 'en-US.json' },
  ],
} as unknown as I18nConfig

describe('resolveLocaleRef', () => {
  it('resolves a unique code', () => {
    expect(resolveLocaleRef(config, 'de-formal').locale?.code).toBe('de-formal')
    expect(resolveLocaleRef(config, 'de-formal').ambiguity).toBeUndefined()
  })

  it('resolves a unique language tag', () => {
    expect(resolveLocaleRef(config, 'en-GB').locale?.code).toBe('en')
  })

  it('resolves a file name, extension included', () => {
    expect(resolveLocaleRef(config, 'de-DE-formal.json').locale?.code).toBe('de-formal')
  })

  it('returns nothing for a ref that matches no field', () => {
    // The exact ref that silently dropped writes in anny-ui.
    expect(resolveLocaleRef(config, 'de-DE-formal').locale).toBeUndefined()
    expect(resolveLocaleRef(config, 'nope').locale).toBeUndefined()
  })

  describe('ambiguity', () => {
    it('reports a ref that matches several locales by language', () => {
      const { locale, ambiguity } = resolveLocaleRef(config, 'de-DE')

      expect(locale?.code).toBe('de')
      expect(ambiguity).toEqual({
        ref: 'de-DE',
        matchedBy: 'language',
        candidates: ['de', 'de-formal'],
        resolvedTo: 'de',
      })
    })

    it('does not flag a ref that matches exactly one locale', () => {
      expect(resolveLocaleRef(config, 'de').ambiguity).toBeUndefined()
      expect(resolveLocaleRef(config, 'en-US').ambiguity).toBeUndefined()
    })
  })

  describe('precedence: code outranks language outranks file', () => {
    // A code must never be shadowed by another locale's language tag, or
    // config ordering silently decides which locale a caller addressed.
    it('prefers the locale whose code matches over one whose language matches', () => {
      const shadowed = {
        locales: [
          { code: 'de-DE', language: 'de-AT', file: 'de-AT.json' },
          { code: 'de', language: 'de-DE', file: 'de-DE.json' },
        ],
      } as unknown as I18nConfig

      // 'de-DE' is locale 2's language but locale 1's code — the code wins,
      // even though the language match comes second in the array.
      expect(resolveLocaleRef(shadowed, 'de-DE').locale?.code).toBe('de-DE')
      expect(resolveLocaleRef(shadowed, 'de-DE').ambiguity).toBeUndefined()
    })

    it('prefers a language match over a file match', () => {
      const cfg = {
        locales: [
          { code: 'a', language: 'x', file: 'shared.json' },
          { code: 'b', language: 'shared.json', file: 'b.json' },
        ],
      } as unknown as I18nConfig

      expect(resolveLocaleRef(cfg, 'shared.json').locale?.code).toBe('b')
    })
  })

  describe('findLocaleSuggestion ranks matches instead of taking the first', () => {
    it('points at the formal locale for "de-DE-formal", not the informal one', () => {
      // `de` matches by containment (its language is de-DE); `de-formal`
      // matches exactly once .json is stripped from its file. Suggesting `de`
      // would send formal German into the informal file.
      expect(findLocaleSuggestion(config, 'de-DE-formal')).toContain('"de-formal"')
      expect(findLocaleSuggestion(config, 'de-DE-formal')).not.toMatch(/Did you mean "de"/)
    })

    it('still suggests a near miss when nothing matches exactly', () => {
      expect(findLocaleSuggestion(config, 'en-G')).toContain('"en"')
    })

    it('returns nothing when no locale is remotely close', () => {
      expect(findLocaleSuggestion(config, 'zzz')).toBe('')
    })
  })

  it('findLocaleImpl keeps returning just the locale', () => {
    expect(findLocaleImpl(config, 'de-formal')?.code).toBe('de-formal')
    expect(findLocaleImpl(config, 'de-DE')?.code).toBe('de')
    expect(findLocaleImpl(config, 'de-DE-formal')).toBeUndefined()
  })
})
