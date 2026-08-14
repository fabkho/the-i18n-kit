import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { artifactToConfig, readArtifact } from '../../src/config/artifact.js'
import type { I18nKitArtifact } from '../../src/config/artifact.js'

/**
 * The artifact is additive: it is preferred when trustworthy and ignored
 * otherwise, and being ignored must never be louder than a warning. A module
 * that cannot be trusted must not break a project that worked without it.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-artifact-'))
  await mkdir(join(dir, '.nuxt'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function validArtifact(overrides: Partial<I18nKitArtifact> = {}): I18nKitArtifact {
  return {
    version: 1,
    generator: '@the-i18n-kit/nuxt@0.1.1',
    appDir: dir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['de'] },
    localeFileFormat: 'json',
    locales: [
      { code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' },
      { code: 'en', language: 'en-GB', file: 'en-GB.json' },
    ],
    layers: [{ rootDir: dir, localeDir: join(dir, 'i18n', 'locales') }],
    ...overrides,
  }
}

async function writeArtifact(content: unknown): Promise<void> {
  await writeFile(
    join(dir, '.nuxt', 'i18n-kit.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  )
}

describe('reading an artifact', () => {
  it('returns it when it is well formed', async () => {
    await writeArtifact(validArtifact())

    expect(await readArtifact(dir)).toMatchObject({ defaultLocale: 'de' })
  })

  it('returns null when there is none', async () => {
    expect(await readArtifact(dir)).toBeNull()
  })

  it('returns null rather than throwing on malformed JSON', async () => {
    await writeArtifact('{ not json')

    expect(await readArtifact(dir)).toBeNull()
  })

  // A future version may mean anything; guessing is how a consumer silently
  // reads a shape that no longer means what it thinks.
  it('returns null on a version this CLI does not know', async () => {
    await writeArtifact({ ...validArtifact(), version: 2 })

    expect(await readArtifact(dir)).toBeNull()
  })

  it('returns null when a required field is missing', async () => {
    const { defaultLocale: _dropped, ...withoutDefault } = validArtifact()
    await writeArtifact(withoutDefault)

    expect(await readArtifact(dir)).toBeNull()
  })

  it('returns null when it describes no locales at all', async () => {
    await writeArtifact(validArtifact({ locales: [] }))

    expect(await readArtifact(dir)).toBeNull()
  })

  // An artifact older than the config it describes is a lie about the current
  // project, and a quiet one.
  it('returns null when the Nuxt config is newer than the artifact', async () => {
    await writeArtifact(validArtifact())
    await writeFile(join(dir, 'nuxt.config.ts'), 'export default {}')

    const future = new Date(Date.now() + 60_000)
    await utimes(join(dir, 'nuxt.config.ts'), future, future)

    expect(await readArtifact(dir)).toBeNull()
  })

  // A layer's own config decides that layer's locales, so an unchanged app
  // config says nothing about the layers it extends.
  it("returns null when a layer's config is newer than the artifact", async () => {
    const layerDir = join(dir, 'layers', 'nested')
    await mkdir(layerDir, { recursive: true })
    await writeArtifact(validArtifact({
      layers: [{ rootDir: dir, localeDir: join(dir, 'i18n', 'locales') }, { rootDir: layerDir }],
    }))
    await writeFile(join(layerDir, 'nuxt.config.ts'), 'export default {}')

    const future = new Date(Date.now() + 60_000)
    await utimes(join(layerDir, 'nuxt.config.ts'), future, future)

    expect(await readArtifact(dir)).toBeNull()
  })

  it('accepts an artifact newer than the config', async () => {
    await writeFile(join(dir, 'nuxt.config.ts'), 'export default {}')
    await writeArtifact(validArtifact())

    const past = new Date(Date.now() - 60_000)
    await utimes(join(dir, 'nuxt.config.ts'), past, past)

    expect(await readArtifact(dir)).not.toBeNull()
  })
})

describe('converting an artifact to a config', () => {
  const root = '/repo'

  it('names layers relative to the directory the CLI was pointed at', async () => {
    const artifact = validArtifact({
      appDir: '/repo/app-admin',
      layers: [
        { rootDir: '/repo/app-admin', localeDir: '/repo/app-admin/i18n/locales' },
        { rootDir: '/repo/app-admin/layers/dashboard-next' },
        { rootDir: '/repo', localeDir: '/repo/i18n/locales' },
      ],
    })

    const config = await artifactToConfig(artifact, '/repo/app-admin', root, null)

    // Not 'root' — a module inside app-admin cannot know it is app-admin from
    // the repo's point of view, which is why names are derived here.
    expect(config.apps).toEqual([
      { name: 'app-admin', rootDir: '/repo/app-admin', layers: ['app-admin', 'dashboard-next', 'root'] },
    ])
    expect(config.localeDirs.map(d => d.layer)).toEqual(['app-admin', 'root'])
  })

  it('keeps a layer without translations out of localeDirs but in layerRootDirs', async () => {
    const artifact = validArtifact({
      appDir: '/repo/app-admin',
      layers: [
        { rootDir: '/repo/app-admin', localeDir: '/repo/app-admin/i18n/locales' },
        { rootDir: '/repo/app-admin/layers/dashboard-next' },
      ],
    })

    const config = await artifactToConfig(artifact, '/repo/app-admin', root, null)

    expect(config.localeDirs).toHaveLength(1)
    expect(config.layerRootDirs).toEqual(['/repo/app-admin', '/repo/app-admin/layers/dashboard-next'])
  })

  // The adapter treats this as unusable and loads the app instead: the fallback
  // path reports a ConfigError naming what is missing, and installing the module
  // must not turn that into an empty result.
  it('yields no locale directories when no layer has one', async () => {
    const artifact = validArtifact({
      appDir: '/repo/app-admin',
      layers: [{ rootDir: '/repo/app-admin' }, { rootDir: '/repo' }],
    })

    const config = await artifactToConfig(artifact, '/repo/app-admin', root, null)

    expect(config.localeDirs).toEqual([])
    expect(config.layerRootDirs).toEqual(['/repo/app-admin', '/repo'])
  })

  it('carries the locale table through unchanged', async () => {
    const config = await artifactToConfig(validArtifact(), dir, root, null)

    expect(config.locales).toEqual([
      { code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' },
      { code: 'en', language: 'en-GB', file: 'en-GB.json' },
    ])
  })

  it('still applies the locales override from .i18n-mcp.json', async () => {
    const config = await artifactToConfig(validArtifact(), dir, root, { locales: ['en'] })

    expect(config.locales.map(l => l.code)).toEqual(['en'])
  })

  it('carries the default locale', async () => {
    const config = await artifactToConfig(validArtifact({ defaultLocale: 'en' }), dir, root, null)

    expect(config.defaultLocale).toBe('en')
  })

  // The module publishes fallbackLocale exactly as Nuxt resolved it, in any of
  // the three shapes @nuxtjs/i18n accepts. Normalising it here rather than in
  // the module keeps one implementation across both paths.
  it.each([
    ['a bare string', 'en', { default: ['en'] }],
    ['an array', ['en', 'de'], { default: ['en', 'de'] }],
    ['a per-locale map', { 'de-formal': ['de'], 'default': 'en' }, { 'de-formal': ['de'], 'default': ['en'] }],
    ['nothing at all', null, { default: ['de'] }],
  ])('normalises %s', async (_label, fallbackLocale, expected) => {
    const artifact = validArtifact({ fallbackLocale: fallbackLocale as never })

    const config = await artifactToConfig(artifact, dir, root, null)

    expect(config.fallbackLocale).toEqual(expected)
  })
})
