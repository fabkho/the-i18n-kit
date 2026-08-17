import { describe, expect, it } from 'vitest'

import { AppMerger } from '../../src/adapters/nuxt/merge-apps.js'
import type { I18nConfig } from '../../src/config/types.js'

/**
 * Policy declared in an app's nuxt.config arrives on that app's config, so the
 * merge has to carry it across. It did not at first: every app's policy was
 * folded in and then thrown away when the merged config took its projectConfig
 * from the file alone, and a locale marked protected in nuxt.config was
 * translated anyway.
 */

function appConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
  return {
    rootDir: '/repo/app-admin',
    defaultLocale: 'de',
    fallbackLocale: { default: ['de'] },
    locales: [{ code: 'de', language: 'de-DE', file: 'de.json' }],
    localeDirs: [{ path: '/repo/app-admin/i18n/locales', layer: 'app-admin', layerRootDir: '/repo/app-admin' }],
    layerRootDirs: ['/repo/app-admin'],
    apps: [{ name: 'app-admin', rootDir: '/repo/app-admin', layers: ['app-admin'] }],
    ...overrides,
  }
}

describe('merging apps', () => {



  it('leaves projectConfig untouched when no app contributed any', async () => {
    const merger = new AppMerger()
    await merger.add(appConfig(), '/repo')

    expect(merger.toConfig('/repo', undefined, merger.locales).projectConfig).toBeUndefined()
    expect(merger.toConfig('/repo', { context: 'x' }, merger.locales).projectConfig).toEqual({ context: 'x' })
  })

  it('deduplicates locales by code across apps', async () => {
    const merger = new AppMerger()
    await merger.add(appConfig(), '/repo')
    await merger.add(appConfig({
      locales: [
        { code: 'de', language: 'de-DE', file: 'de.json' },
        { code: 'en', language: 'en-GB', file: 'en.json' },
      ],
    }), '/repo')

    expect(merger.locales.map(l => l.code)).toEqual(['de', 'en'])
  })
})
