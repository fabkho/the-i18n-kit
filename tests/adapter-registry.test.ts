import { describe, it, expect, beforeEach } from 'vitest'
import type { FrameworkAdapter } from '../src/adapters/types'
import { registerAdapter, detectFramework, resetRegistry } from '../src/adapters/registry'

function createFakeAdapter(
  name: string,
  confidence: number,
): FrameworkAdapter {
  return {
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    localeFileFormat: 'json',
    detect: async () => confidence,
    resolve: async () => ({
      rootDir: '/fake',
      defaultLocale: 'en',
      fallbackLocale: { default: ['en'] },
      locales: [],
      localeDirs: [],
      layerRootDirs: [],
    }),
  }
}

describe('adapter registry', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('picks the adapter with the highest confidence score', async () => {
    const low = createFakeAdapter('low', 1)
    const high = createFakeAdapter('high', 2)

    registerAdapter(low)
    registerAdapter(high)

    const winner = await detectFramework('/some/dir')
    expect(winner.name).toBe('high')
  })

  it('uses framework hint to bypass detection', async () => {
    const nuxt = createFakeAdapter('nuxt', 0)
    const laravel = createFakeAdapter('laravel', 2)

    registerAdapter(nuxt)
    registerAdapter(laravel)

    const winner = await detectFramework('/some/dir', 'nuxt')
    expect(winner.name).toBe('nuxt')
  })

  it('throws when hint names an unknown adapter', async () => {
    registerAdapter(createFakeAdapter('nuxt', 2))

    await expect(detectFramework('/some/dir', 'unknown'))
      .rejects.toThrow(/unknown/)
  })

  it('throws ConfigError when all adapters return confidence 0', async () => {
    registerAdapter(createFakeAdapter('a', 0))
    registerAdapter(createFakeAdapter('b', 0))

    await expect(detectFramework('/some/dir'))
      .rejects.toThrow(/No framework detected/)
  })

  it('calls detect on all registered adapters', async () => {
    let aCalled = false
    let bCalled = false

    const a: FrameworkAdapter = {
      ...createFakeAdapter('a', 1),
      detect: async () => { aCalled = true; return 1 },
    }
    const b: FrameworkAdapter = {
      ...createFakeAdapter('b', 2),
      detect: async () => { bCalled = true; return 2 },
    }

    registerAdapter(a)
    registerAdapter(b)

    await detectFramework('/some/dir')

    expect(aCalled).toBe(true)
    expect(bCalled).toBe(true)
  })
})
