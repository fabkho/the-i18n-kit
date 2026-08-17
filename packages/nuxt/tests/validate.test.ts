import { describe, expect, it } from 'vitest'

import { checkOwnedKeys, checkProtectedLocales } from '../src/validate'
import type { ArtifactLocale } from '../src/artifact'

/** anny-ui's real shape: two German locales sharing one language tag. */
const locales: ArtifactLocale[] = [
  { code: 'de', language: 'de-DE', file: 'de-DE.json' },
  { code: 'de-formal', language: 'de-DE', file: 'de-DE-formal.json' },
  { code: 'en', language: 'en-GB', file: 'en-GB.json' },
  { code: 'en-us', language: 'en-US', file: 'en-US.json' },
]

describe('protectedLocales against the real locale table', () => {
  // The bug this module exists to catch: the code is `de-formal`, so
  // `de-DE-formal` protected nothing while appearing to protect formal German.
  it('errors on a ref that matches nothing, naming the valid codes', () => {
    const [diagnostic, ...rest] = checkProtectedLocales(['de-DE-formal'], locales)

    expect(rest).toEqual([])
    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain('"de-DE-formal" matches no locale')
    expect(diagnostic?.message).toContain('de, de-formal, en, en-us')
  })

  it('errors on a ref that matches several, naming all of them', () => {
    const [diagnostic] = checkProtectedLocales(['de-DE'], locales)

    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain('ambiguous')
    expect(diagnostic?.message).toContain('de, de-formal')
  })

  it('accepts an exact code without comment', () => {
    expect(checkProtectedLocales(['de-formal'], locales)).toEqual([])
  })

  // Unambiguous today only because no second locale declares en-GB. Adding one
  // would turn this ref ambiguous without touching the line that wrote it.
  it('warns when a ref resolves by language tag rather than by code', () => {
    const [diagnostic] = checkProtectedLocales(['en-GB'], locales)

    expect(diagnostic?.level).toBe('warn')
    expect(diagnostic?.message).toContain('matched by language rather than code')
    expect(diagnostic?.message).toContain('Prefer "en"')
  })

  it('warns the same way for a file name', () => {
    const [diagnostic] = checkProtectedLocales(['en-US.json'], locales)

    expect(diagnostic?.level).toBe('warn')
    expect(diagnostic?.message).toContain('Prefer "en-us"')
  })

  // "Available codes: " with nothing after it reads as a broken message rather
  // than as the finding it is.
  it('says so plainly when no locales resolved at all', () => {
    const [diagnostic] = checkProtectedLocales(['de'], [])

    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain('No locales resolved')
    expect(diagnostic?.message).not.toContain('Available codes:')
  })

  it('has nothing to say when protectedLocales is absent', () => {
    expect(checkProtectedLocales(undefined, locales)).toEqual([])
  })
})

describe('keys the module derives', () => {
  const json = (config: Record<string, unknown>) => ({ path: '/app/.i18n-mcp.json', config })
  const typed = (config: Record<string, unknown>) => ({ path: '/app/i18n-kit.config.ts', config })

  // Both files, because the typed one is what the docs recommend — checking
  // only the JSON config left the declaration site people are steered towards
  // as the one that could conflict in silence (#362).
  it.each([
    ['.i18n-mcp.json', json],
    ['i18n-kit.config.ts', typed],
  ])('errors when %s declares a derived key', (filename, source) => {
    const [diagnostic, ...rest] = checkOwnedKeys([source({ locales: ['en'] })])

    expect(rest).toEqual([])
    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain(`declares "locales"`)
    // Naming the file is the point: with two of them, "remove it" is otherwise
    // an instruction you cannot act on.
    expect(diagnostic?.message).toContain(filename)
  })

  it('reports every conflict rather than only the first', () => {
    const diagnostics = checkOwnedKeys([json({ locales: [], defaultLocale: 'de', glossary: {} })])

    expect(diagnostics).toHaveLength(2)
  })

  it('reports the same key declared in both files once per file', () => {
    const diagnostics = checkOwnedKeys([json({ defaultLocale: 'en' }), typed({ defaultLocale: 'de' })])

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map(d => d.message).join('\n')).toContain('i18n-kit.config.ts')
  })

  it('leaves the keys Nuxt cannot know alone', () => {
    const config = {
      glossary: { anny: 'never translate' },
      translationPrompt: 'be concise',
      protectedLocales: ['de-formal'],
      orphanScan: {},
      context: 'a booking platform',
    }

    expect(checkOwnedKeys([typed(config)])).toEqual([])
  })

  it('has nothing to say when there is no config file', () => {
    expect(checkOwnedKeys([])).toEqual([])
  })
})
