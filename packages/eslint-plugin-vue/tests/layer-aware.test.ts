import { describe, it, expect } from 'vitest'
import { layerAware } from '../src/layer-aware.js'

/**
 * The factory's expected output is the anny-ui spike config (#422): the
 * hand-written blocks validated 2026-08-24 are what these fixtures assert,
 * generated.
 */

const annyUiShaped = {
  defaultLocale: 'de',
  localeDirs: [
    { layer: 'root', path: '/repo/i18n/locales', layerRootDir: '/repo' },
    { layer: 'app-admin', path: '/repo/app-admin/i18n/locales', layerRootDir: '/repo/app-admin' },
    { layer: 'app-shop', path: '/repo/app-shop/i18n/locales', layerRootDir: '/repo/app-shop' },
    // The alias: app-outlook consumes app-shop's catalogue.
    { layer: 'app-outlook', path: '/repo/app-shop/i18n/locales', layerRootDir: '/repo/app-outlook' },
  ],
}

describe('layered project', () => {
  it('emits the spike-validated shape: rules, root scope, one block per app', async () => {
    const blocks = await layerAware({ projectDir: '/repo', config: annyUiShaped })

    expect(blocks.map(b => b.name)).toEqual([
      '@the-i18n-kit/layer-aware/rules',
      '@the-i18n-kit/layer-aware/root',
      '@the-i18n-kit/layer-aware/app-admin',
      '@the-i18n-kit/layer-aware/app-shop',
      '@the-i18n-kit/layer-aware/app-outlook',
    ])

    const settings = (name: string) =>
      (blocks.find(b => b.name === name)?.settings?.['vue-i18n'] as { localeDir: string[] }).localeDir

    // Root-owned code sees only the root catalogue, reference locale only.
    expect(settings('@the-i18n-kit/layer-aware/root')).toEqual(['i18n/locales/de*.json'])
    // An app sees root + its own layer.
    expect(settings('@the-i18n-kit/layer-aware/app-admin')).toEqual([
      'i18n/locales/de*.json',
      'app-admin/i18n/locales/de*.json',
    ])
    // The alias resolves to the aliased catalogue under the app's own files glob.
    const outlook = blocks.find(b => b.name === '@the-i18n-kit/layer-aware/app-outlook')!
    expect(outlook.files).toEqual(['app-outlook/**'])
    expect(settings('@the-i18n-kit/layer-aware/app-outlook')).toContain('app-shop/i18n/locales/de*.json')

    // The rules block wires the intlify plugin and only no-missing-keys.
    const rules = blocks.find(b => b.name === '@the-i18n-kit/layer-aware/rules')!
    expect(Object.keys(rules.rules ?? {})).toEqual(['@intlify/vue-i18n/no-missing-keys'])
    expect(rules.plugins).toHaveProperty('@intlify/vue-i18n')
  })

  it('honours a reference-locale override', async () => {
    const blocks = await layerAware({ projectDir: '/repo', config: annyUiShaped, referenceLocaleFile: 'de-DE.json' })
    const root = blocks.find(b => b.name === '@the-i18n-kit/layer-aware/root')!
    expect((root.settings?.['vue-i18n'] as { localeDir: string[] }).localeDir).toEqual(['i18n/locales/de-DE.json'])
  })
})

describe('plain Vue, no layers', () => {
  it('degrades to a single-catalogue block — the plugin is not monorepo-only', async () => {
    const blocks = await layerAware({
      projectDir: '/app',
      config: { defaultLocale: 'en', localeDirs: [{ layer: 'root', path: '/app/src/locales', layerRootDir: '/app' }] },
    })

    expect(blocks.map(b => b.name)).toEqual([
      '@the-i18n-kit/layer-aware/rules',
      '@the-i18n-kit/layer-aware/root',
    ])
    const root = blocks.find(b => b.name === '@the-i18n-kit/layer-aware/root')!
    expect((root.settings?.['vue-i18n'] as { localeDir: string[] }).localeDir).toEqual(['src/locales/en*.json'])
  })
})
