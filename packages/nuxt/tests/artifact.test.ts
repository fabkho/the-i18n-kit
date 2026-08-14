import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildArtifact } from '../src/artifact'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-kit-artifact-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A layer directory that holds locale JSON, as Nuxt would resolve it. */
async function layerWithLocales(name: string): Promise<string> {
  const rootDir = join(dir, name)
  await mkdir(join(rootDir, 'i18n', 'locales'), { recursive: true })
  await writeFile(join(rootDir, 'i18n', 'locales', 'en.json'), '{}')
  return rootDir
}

async function layerWithoutLocales(name: string): Promise<string> {
  const rootDir = join(dir, name)
  await mkdir(rootDir, { recursive: true })
  return rootDir
}

const build = (i18n: Record<string, unknown>, layers: Array<{ config: { rootDir: string, i18n?: Record<string, unknown> } }>) =>
  buildArtifact({ appDir: dir, i18n, layers, generator: 'test' })

describe('the locale table', () => {
  it('carries all four ref forms, so any of them can be resolved', async () => {
    const artifact = await build(
      { locales: [{ code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' }] },
      [],
    )

    expect(artifact.locales).toEqual([
      { code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' },
    ])
  })

  // A layered app sees each locale once per layer that declares it: anny-ui's
  // app-admin reports 60 entries for 30 locales, every duplicate identical.
  it('deduplicates by code, keeping the first', async () => {
    const artifact = await build({
      locales: [
        { code: 'de', language: 'de-DE', file: 'de-DE.json' },
        { code: 'en', language: 'en-GB', file: 'en-GB.json' },
        { code: 'de', language: 'de-DE', file: 'de-DE.json' },
      ],
    }, [])

    expect(artifact.locales.map(l => l.code)).toEqual(['de', 'en'])
  })

  // Order is precedence, and the CLI's fallback path reads the same array in
  // the same order. Sorting would make the two paths disagree.
  it('preserves declaration order rather than sorting', async () => {
    const artifact = await build({
      locales: [
        { code: 'nb', language: 'nb-NO', file: 'nb.json' },
        { code: 'da', language: 'da-DK', file: 'da.json' },
        { code: 'bg', language: 'bg-BG', file: 'bg.json' },
      ],
    }, [])

    expect(artifact.locales.map(l => l.code)).toEqual(['nb', 'da', 'bg'])
  })

  it('drops entries without a code or a file, which cannot be addressed', async () => {
    const artifact = await build({
      locales: [
        { code: 'de', file: 'de.json' },
        { code: 'no-file' },
        { file: 'no-code.json' },
      ],
    }, [])

    expect(artifact.locales.map(l => l.code)).toEqual(['de'])
  })

  it('reads the legacy iso field as the language tag', async () => {
    const artifact = await build({ locales: [{ code: 'de', iso: 'de-DE', file: 'de.json' }] }, [])

    expect(artifact.locales[0]?.language).toBe('de-DE')
  })
})

describe('the layer list', () => {
  it('reports a layer that has no locale directory of its own', async () => {
    const withLocales = await layerWithLocales('app-admin')
    const sourceOnly = await layerWithoutLocales('dashboard-next')

    const artifact = await build({ locales: [{ code: 'de', file: 'de.json' }] }, [
      { config: { rootDir: withLocales } },
      { config: { rootDir: sourceOnly } },
    ])

    // Dropping the second would remove it from source scanning, which surfaces
    // as false orphans rather than as an error.
    expect(artifact.layers).toEqual([
      { rootDir: withLocales, localeDir: join(withLocales, 'i18n', 'locales') },
      { rootDir: sourceOnly },
    ])
  })

  it('ignores a locale directory that exists but holds no JSON', async () => {
    const rootDir = join(dir, 'empty')
    await mkdir(join(rootDir, 'i18n', 'locales'), { recursive: true })
    await writeFile(join(rootDir, 'i18n', 'locales', 'README.md'), '')

    const artifact = await build({ locales: [{ code: 'de', file: 'de.json' }] }, [
      { config: { rootDir } },
    ])

    expect(artifact.layers).toEqual([{ rootDir }])
  })

  it('honours a layer that relocates its own locale directory', async () => {
    const rootDir = join(dir, 'custom')
    await mkdir(join(rootDir, 'translations'), { recursive: true })
    await writeFile(join(rootDir, 'translations', 'de.json'), '{}')

    const artifact = await build({ locales: [{ code: 'de', file: 'de.json' }] }, [
      { config: { rootDir, i18n: { langDir: 'translations', restructureDir: '.' } } },
    ])

    expect(artifact.layers[0]?.localeDir).toBe(join(rootDir, 'translations'))
  })
})

describe('the fallback chain', () => {
  // Published exactly as Nuxt resolved it. The CLI normalises the three shapes
  // @nuxtjs/i18n accepts, so that one implementation serves both the artifact
  // path and the fallback path rather than two that have to agree.
  it.each([
    ['a bare string', 'en'],
    ['an array', ['en', 'de']],
    ['a per-locale map', { 'de-formal': ['de'], 'default': 'en' }],
  ])('passes %s through untouched', async (_label, fallbackLocale) => {
    const artifact = await build(
      { locales: [{ code: 'de', file: 'de.json' }], defaultLocale: 'de', fallbackLocale },
      [],
    )

    expect(artifact.fallbackLocale).toEqual(fallbackLocale)
  })

  it('reports null when nothing is configured, rather than inventing a chain', async () => {
    const artifact = await build({ locales: [{ code: 'de', file: 'de.json' }], defaultLocale: 'de' }, [])

    expect(artifact.fallbackLocale).toBeNull()
  })
})
