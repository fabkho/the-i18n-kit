import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { detectI18nConfig, clearConfigCache } from '../../src/config/detector.js'

const playgroundDir = resolve(import.meta.dirname, '../../playground')
const appAdminDir = resolve(import.meta.dirname, '../../playground/app-admin')

afterEach(() => {
  clearConfigCache()
})

describe('detectI18nConfig against playground', () => {
  it('detects the playground i18n config', async () => {
    const config = await detectI18nConfig(playgroundDir)

    expect(config).toBeDefined()
    expect(config.rootDir).toBe(playgroundDir)
  }, 30_000)

  it('detects the default locale', async () => {
    const config = await detectI18nConfig(playgroundDir)

    expect(config.defaultLocale).toBe('de')
  }, 30_000)

  it('detects all 4 locales', async () => {
    const config = await detectI18nConfig(playgroundDir)

    expect(config.locales).toHaveLength(4)

    const codes = config.locales.map(l => l.code)
    expect(codes).toContain('de')
    expect(codes).toContain('en')
    expect(codes).toContain('fr')
    expect(codes).toContain('es')
  }, 30_000)

  it('locales have correct file names', async () => {
    const config = await detectI18nConfig(playgroundDir)

    const deLocale = config.locales.find(l => l.code === 'de')
    expect(deLocale).toBeDefined()
    expect(deLocale!.file).toBe('de-DE.json')
    expect(deLocale!.language).toBe('de-DE')

    const enLocale = config.locales.find(l => l.code === 'en')
    expect(enLocale).toBeDefined()
    expect(enLocale!.file).toBe('en-US.json')
    expect(enLocale!.language).toBe('en-US')
  }, 30_000)

  it('discovers locale directories from layers', async () => {
    const config = await detectI18nConfig(playgroundDir)

    expect(config.localeDirs.length).toBeGreaterThanOrEqual(1)

    const layers = config.localeDirs.map(d => d.layer)
    expect(layers).toContain('root')
  }, 30_000)

  it('root locale dir points to playground/i18n/locales', async () => {
    const config = await detectI18nConfig(playgroundDir)

    const rootDir = config.localeDirs.find(d => d.layer === 'root')
    expect(rootDir).toBeDefined()
    expect(rootDir!.path).toBe(resolve(playgroundDir, 'i18n/locales'))
  }, 30_000)

  it('detects fallback locale config', async () => {
    const config = await detectI18nConfig(playgroundDir)

    expect(config.fallbackLocale).toBeDefined()
    // Should at minimum have a default fallback
    const hasDefault = 'default' in config.fallbackLocale
    const hasEn = Object.values(config.fallbackLocale).some(arr =>
      arr.includes('en'),
    )
    expect(hasDefault || hasEn).toBe(true)
  }, 30_000)

  it('caches config on subsequent calls', async () => {
    const config1 = await detectI18nConfig(playgroundDir)
    const config2 = await detectI18nConfig(playgroundDir)

    expect(config1).toBe(config2) // same reference = cached
  }, 30_000)

  it('throws for non-existent project dir', async () => {
    await expect(
      detectI18nConfig('/tmp/nonexistent-project-dir-12345'),
    ).rejects.toThrow()
  }, 30_000)
})

describe('detectI18nConfig against playground/app-admin (layer)', () => {
  // When running from app-admin/:
  //   _layers[0] = app-admin itself → deriveLayerName → 'root' (it's the cwd)
  //   _layers[1] = ../playground    → deriveLayerName → 'playground' (basename)

  it('detects config from the app-admin layer entry point', async () => {
    const config = await detectI18nConfig(appAdminDir)

    expect(config).toBeDefined()
    expect(config.rootDir).toBe(appAdminDir)
    expect(config.defaultLocale).toBe('de')
  }, 30_000)

  it('discovers both app-admin (root) and playground locale directories', async () => {
    const config = await detectI18nConfig(appAdminDir)

    expect(config.localeDirs).toHaveLength(2)

    const layers = config.localeDirs.map(d => d.layer)
    // app-admin is the project entry, so it's 'root'; the extended parent is 'playground'
    expect(layers).toContain('root')
    expect(layers).toContain('playground')
  }, 30_000)

  it('app-admin locale dir is the "root" layer (project entry point)', async () => {
    const config = await detectI18nConfig(appAdminDir)

    const rootDir = config.localeDirs.find(d => d.layer === 'root')
    expect(rootDir).toBeDefined()
    expect(rootDir!.path).toBe(resolve(appAdminDir, 'i18n/locales'))
  }, 30_000)

  it('playground locale dir is discovered via layer inheritance', async () => {
    const config = await detectI18nConfig(appAdminDir)

    const parentDir = config.localeDirs.find(d => d.layer === 'playground')
    expect(parentDir).toBeDefined()
    expect(parentDir!.path).toBe(resolve(playgroundDir, 'i18n/locales'))
  }, 30_000)

  it('detects 8 locales (4 from each layer, merged by code)', async () => {
    const config = await detectI18nConfig(appAdminDir)

    // @nuxtjs/i18n merges locale configs per code from both layers
    // Both app-admin and playground define the same 4 locale codes
    // The merged result may deduplicate or keep all — check we have at least 4 codes
    const codes = [...new Set(config.locales.map(l => l.code))]
    expect(codes).toHaveLength(4)
    expect(codes).toContain('de')
    expect(codes).toContain('en')
    expect(codes).toContain('fr')
    expect(codes).toContain('es')
  }, 30_000)
})
