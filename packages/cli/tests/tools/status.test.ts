import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * status (#253). Coverage in one call, so an agent stops calling `missing` per
 * layer and doing arithmetic on key lists.
 */
let dir: string

vi.mock('../../src/config/detector.js', async () => {
  const { resolve } = await import('node:path')
  const { readFile: read } = await import('node:fs/promises')
  return {
    detectI18nConfig: vi.fn(async (projectDir: string) => {
      const cfg = JSON.parse(await read(resolve(projectDir, '.i18n-mcp.json'), 'utf-8')) as {
        locales: string[]
        protectedLocales?: string[]
        layers?: string[]
      }
      const layers = cfg.layers ?? ['root']
      return {
        rootDir: projectDir,
        defaultLocale: 'en',
        fallbackLocale: { default: ['en'] },
        locales: cfg.locales.map(code => ({ code, language: code, file: `${code}.json` })),
        localeDirs: layers.map(layer => ({
          path: resolve(projectDir, layer),
          layer,
          layerRootDir: projectDir,
        })),
        layerRootDirs: [projectDir],
        projectConfig: { protectedLocales: cfg.protectedLocales ?? [] },
        apps: [{ name: 'root', rootDir: projectDir, layers }],
      }
    }),
    clearConfigCache: vi.fn(),
    getCachedConfig: vi.fn(() => null),
  }
})

const { getTranslationStatus } = await import('../../src/core/operations.js')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-status-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function project(opts: {
  locales: string[]
  protectedLocales?: string[]
  layers?: Record<string, Record<string, unknown>>
}) {
  const layers = opts.layers ?? {}
  await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({
    locales: opts.locales,
    protectedLocales: opts.protectedLocales,
    layers: Object.keys(layers),
  }))
  for (const [layer, files] of Object.entries(layers)) {
    await mkdir(join(dir, layer), { recursive: true })
    for (const [code, data] of Object.entries(files)) {
      await writeFile(join(dir, layer, `${code}.json`), JSON.stringify(data))
    }
  }
}

const byCode = (result: { locales?: Array<{ code: string }> }, code: string) =>
  result.locales?.find(l => l.code === code)

describe('per-locale counts', () => {
  beforeEach(async () => {
    await project({
      locales: ['en', 'de', 'fr'],
      layers: {
        root: {
          en: { a: '1', b: '2', c: '3', d: '4' },
          de: { a: '1', b: '2', c: '' },
          fr: { a: '1' },
        },
      },
    })
  })

  it('separates translated, missing and empty', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    expect(byCode(result, 'de')).toMatchObject({
      total: 4, translated: 2, empty: 1, missing: 1, completion: 50,
    })
    expect(byCode(result, 'fr')).toMatchObject({
      total: 4, translated: 1, empty: 0, missing: 3, completion: 25,
    })
  })

  // An empty string is a scaffolded key nobody filled. Counting it as complete
  // is how a locale reads as done while rendering blanks.
  it('counts empty strings as untranslated', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    expect(byCode(result, 'de')?.translated).toBe(2)
  })

  it('reports an overall percentage so no caller does the arithmetic', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    // 3 translated of 8 reference keys across two locales.
    expect(result.summary.completionPercent).toBe(37.5)
    expect(result.summary.totalKeys).toBe(8)
    expect(result.summary.translatedKeys).toBe(3)
  })

  it('excludes the reference locale from the target list', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    expect(result.locales?.map(l => l.code)).toEqual(['de', 'fr'])
  })
})

describe('protected locales', () => {
  beforeEach(async () => {
    await project({
      locales: ['en', 'de', 'xx'],
      protectedLocales: ['xx'],
      layers: { root: { en: { a: '1', b: '2' }, de: { a: '1', b: '2' }, xx: {} } },
    })
  })

  it('marks them rather than counting them as failures', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    expect(byCode(result, 'xx')).toMatchObject({
      protected: true, excludedFromOverall: true, missing: 2, completion: 0,
    })
  })

  it('keeps them out of the overall figure', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    // de is complete; the untouched protected locale must not drag this down.
    expect(result.summary.completionPercent).toBe(100)
    expect(result.summary.protectedLocales).toEqual(['xx'])
    expect(result.summary.localesChecked).toBe(1)
  })

  it('keeps them out of the per-layer figure too', async () => {
    const result = await getTranslationStatus({ projectDir: dir })

    expect(result.layers?.[0]).toMatchObject({ layer: 'root', completion: 100 })
  })
})

describe('per-layer breakdown', () => {
  it('reports each layer separately', async () => {
    await project({
      locales: ['en', 'de'],
      layers: {
        root: { en: { a: '1', b: '2' }, de: { a: '1', b: '2' } },
        'app-admin': { en: { x: '1', y: '2', z: '3', w: '4' }, de: { x: '1' } },
      },
    })

    const result = await getTranslationStatus({ projectDir: dir })

    expect(result.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'root', total: 2, translated: 2, completion: 100 }),
      expect.objectContaining({ layer: 'app-admin', total: 4, translated: 1, completion: 25 }),
    ]))
  })

  it('scans a single layer when asked', async () => {
    await project({
      locales: ['en', 'de'],
      layers: {
        root: { en: { a: '1' }, de: { a: '1' } },
        'app-admin': { en: { x: '1', y: '2' }, de: {} },
      },
    })

    const result = await getTranslationStatus({ projectDir: dir, layer: 'app-admin' })

    expect(result.summary.layersScanned).toEqual(['app-admin'])
    expect(result.summary.completionPercent).toBe(0)
  })
})

describe('output size', () => {
  it('returns only the summary when outputFile is given', async () => {
    await project({
      locales: ['en', 'de'],
      layers: { root: { en: { a: '1' }, de: {} } },
    })

    const result = await getTranslationStatus({ projectDir: dir, outputFile: 'status.json' })

    expect(result.reportFile).toContain('status.json')
    expect(result.locales).toBeUndefined()
    expect(result.layers).toBeUndefined()
    expect(result.summary.completionPercent).toBe(0)

    // The breakdown is not lost, just moved.
    const written = JSON.parse(await readFile(join(dir, 'status.json'), 'utf-8'))
    expect(written.locales).toHaveLength(1)
  })
})

describe('edge cases', () => {
  it('reports 100% for a project with nothing to translate', async () => {
    await project({ locales: ['en', 'de'], layers: { root: { en: {}, de: {} } } })

    const result = await getTranslationStatus({ projectDir: dir })

    expect(result.summary.completionPercent).toBe(100)
  })

  // An empty reference value is nothing to translate *from*, so it would
  // deflate every locale equally and hide the real gaps.
  it('ignores reference keys that are themselves empty', async () => {
    await project({
      locales: ['en', 'de'],
      layers: { root: { en: { a: '1', b: '' }, de: { a: '1' } } },
    })

    const result = await getTranslationStatus({ projectDir: dir })

    expect(result.summary.totalKeys).toBe(1)
    expect(result.summary.completionPercent).toBe(100)
  })

  it('treats a locale with no file as entirely missing, not an error', async () => {
    await project({ locales: ['en', 'de'], layers: { root: { en: { a: '1', b: '2' } } } })

    const result = await getTranslationStatus({ projectDir: dir })

    expect(byCode(result, 'de')).toMatchObject({ missing: 2, completion: 0 })
  })
})
