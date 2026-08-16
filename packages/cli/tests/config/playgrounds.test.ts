import { describe, it, expect, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import { detectI18nConfig, clearConfigCache } from '../../src/config/detector.js'

/**
 * The playgrounds are the only place every adapter is exercised end to end
 * against a project rather than a fixture assembled inside a test. Asserting
 * the resolution each one is there to demonstrate keeps them from rotting into
 * directories nobody runs — a playground that silently stopped proving its
 * point would be worse than not having it.
 */
const playgroundsDir = resolve(import.meta.dirname, '../../../../playground')

beforeEach(() => {
  clearConfigCache()
})

describe('playground/react', () => {
  it('takes its default locale from next-intl, not from directory order', async () => {
    const config = await detectI18nConfig(resolve(playgroundsDir, 'react'))

    // messages/ sorts de-DE first; routing.ts says otherwise and wins (#296).
    expect(config.framework).toBe('react')
    expect(config.defaultLocale).toBe('en-US')
    expect(config.locales.map(l => l.code).sort()).toEqual(['de-DE', 'en-US', 'es-ES', 'fr-FR'])
  })
})

describe('playground/vue', () => {
  it('finds locale files in a directory no candidate list contains', async () => {
    const config = await detectI18nConfig(resolve(playgroundsDir, 'vue'))

    expect(config.framework).toBe('vue')
    expect(config.localeDirs.map(d => d.path)).toEqual([
      resolve(playgroundsDir, 'vue/src/translations'),
    ])
  })

  it('reads defaultLocale and protectedLocales from the typed config', async () => {
    const config = await detectI18nConfig(resolve(playgroundsDir, 'vue'))

    expect(config.defaultLocale).toBe('en-US')
    expect(config.projectConfig?.protectedLocales).toEqual(['de-DE'])
  })
})

describe('playground/generic', () => {
  it('activates on localeDirs + defaultLocale alone, with nothing to detect', async () => {
    const config = await detectI18nConfig(resolve(playgroundsDir, 'generic'))

    expect(config.framework).toBe('generic')
    expect(config.defaultLocale).toBe('en')
    expect(config.localeDirs.map(d => d.path)).toEqual([
      resolve(playgroundsDir, 'generic/translations'),
    ])
  })
})

describe('playground/laravel', () => {
  it('resolves PHP locale directories', async () => {
    const config = await detectI18nConfig(resolve(playgroundsDir, 'laravel'))

    expect(config.framework).toBe('laravel')
    expect(config.localeFileFormat).toBe('php-array')
    expect(config.locales.map(l => l.code).sort()).toEqual(['de', 'en', 'es', 'fr'])
  })
})
