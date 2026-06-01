import { describe, it, expect, vi } from 'vitest'
import { applyLocaleOverride } from '../../src/config/locale-override'
import type { LocaleDefinition } from '../../src/config/types'

const discovered: LocaleDefinition[] = [
  { code: 'en', language: 'en-US', file: 'en.json' },
  { code: 'de', language: 'de-DE', file: 'de.json' },
  { code: 'fr', language: 'fr-FR', file: 'fr.json' },
]

describe('applyLocaleOverride', () => {
  it('returns discovered unchanged when override is undefined', () => {
    expect(applyLocaleOverride(discovered, undefined)).toBe(discovered)
  })

  it('returns discovered unchanged when override is empty array', () => {
    expect(applyLocaleOverride(discovered, [])).toBe(discovered)
  })

  it('filters discovered locales to the configured codes, preserving metadata', () => {
    const result = applyLocaleOverride(discovered, ['de', 'en'])
    expect(result).toHaveLength(2)
    expect(result.map(l => l.code)).toEqual(['de', 'en'])
    expect(result[0].file).toBe('de.json')
    expect(result[1].file).toBe('en.json')
  })

  it('preserves the order from the override list, not the discovered order', () => {
    const result = applyLocaleOverride(discovered, ['fr', 'en', 'de'])
    expect(result.map(l => l.code)).toEqual(['fr', 'en', 'de'])
  })

  it('drops discovered locales not in the override', () => {
    const result = applyLocaleOverride(discovered, ['en'])
    expect(result.map(l => l.code)).toEqual(['en'])
  })

  it('creates minimal entries for configured codes missing from discovery', () => {
    const result = applyLocaleOverride(discovered, ['en', 'pt'])
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ code: 'pt', language: 'pt' })
  })
})
