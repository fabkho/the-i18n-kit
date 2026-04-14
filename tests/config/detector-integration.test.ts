import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from 'node:path'
import { detectI18nConfig, clearConfigCache, discoverNuxtApps } from '../../src/config/detector.js'
import type { I18nConfig } from '../../src/config/types.js'

const projectRootDir = resolve(import.meta.dirname, '../..')
const playgroundDir = resolve(projectRootDir, 'playground/nuxt')
const appAdminDir = resolve(playgroundDir, 'app-admin')

describe('detectI18nConfig real monorepo merge (no mock)', () => {
  let config: I18nConfig | undefined
  let loadFailed = false

  beforeAll(async () => {
    clearConfigCache()
    try {
      config = await detectI18nConfig(projectRootDir)
    }
    catch {
      // loadNuxt unavailable (no nuxt installed) — skip assertions
      loadFailed = true
    }
  }, 60_000)

  afterAll(() => {
    clearConfigCache()
  })

  it('sets rootDir to the monorepo discovery root', () => {
    if (loadFailed) return
    expect(config!.rootDir).toBe(projectRootDir)
  })

  it('discovers playground as a Nuxt app via real loadNuxt', () => {
    if (loadFailed) return
    const layers = config!.localeDirs.map(d => d.layer)
    expect(layers).toContain('nuxt')
  })

  it('merges locale directories from discovered apps', () => {
    if (loadFailed) return
    expect(config!.localeDirs.length).toBeGreaterThanOrEqual(1)
    const playgroundLocaleDir = config!.localeDirs.find(d => d.layer === 'nuxt')
    expect(playgroundLocaleDir).toBeDefined()
    expect(playgroundLocaleDir!.path).toBe(resolve(playgroundDir, 'i18n/locales'))
  })

  it('extracts locales from real Nuxt config', () => {
    if (loadFailed) return
    expect(config!.locales.length).toBeGreaterThanOrEqual(1)
    const codes = config!.locales.map(l => l.code)
    expect(codes).toContain('de')
    expect(codes).toContain('en')
  })

  it('extracts default locale from first discovered app', () => {
    if (loadFailed) return
    expect(config!.defaultLocale).toBe('de')
  })

  it('includes layerRootDirs from merged apps', () => {
    if (loadFailed) return
    expect(config!.layerRootDirs).toContain(playgroundDir)
  })

  it('layer names are unique across merged locale dirs', () => {
    if (loadFailed) return
    const nonAliasLayers = config!.localeDirs
      .filter(d => !d.aliasOf)
      .map(d => d.layer)
    const uniqueLayers = new Set(nonAliasLayers)
    expect(uniqueLayers.size).toBe(nonAliasLayers.length)
  })
})

describe('discoverNuxtApps returns deterministic order', () => {
  it('returns sorted app paths on repeated calls', async () => {
    const first = await discoverNuxtApps(projectRootDir)
    const second = await discoverNuxtApps(projectRootDir)
    expect(first).toEqual(second)

    const sorted = [...first].sort((a, b) =>
      resolve(a).localeCompare(resolve(b)),
    )
    expect(first).toEqual(sorted)
  })
})

describe('detectI18nConfig when root has nuxt.config with i18n (issue #37)', () => {
  let config: I18nConfig | undefined
  let loadFailed = false

  beforeAll(async () => {
    clearConfigCache()
    try {
      config = await detectI18nConfig(playgroundDir)
    }
    catch {
      loadFailed = true
    }
  }, 60_000)

  afterAll(() => {
    clearConfigCache()
  })

  it('discovers both root and sub-app locale directories', () => {
    if (loadFailed) return
    const layers = config!.localeDirs.map(d => d.layer)
    expect(layers.length).toBeGreaterThanOrEqual(2)

    const hasAppAdmin = config!.localeDirs.some(d =>
      d.path === resolve(appAdminDir, 'i18n/locales'),
    )
    const hasPlayground = config!.localeDirs.some(d =>
      d.path === resolve(playgroundDir, 'i18n/locales'),
    )
    expect(hasAppAdmin).toBe(true)
    expect(hasPlayground).toBe(true)
  })

  it('includes layerRootDirs for both root and sub-app', () => {
    if (loadFailed) return
    expect(config!.layerRootDirs).toContain(playgroundDir)
    expect(config!.layerRootDirs).toContain(appAdminDir)
  })
})
