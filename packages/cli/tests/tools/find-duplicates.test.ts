import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { I18nConfig } from '../../src/config/types.js'

/**
 * Seam tests for findDuplicateKeys against real temp locale files. The
 * generic adapter only resolves single-layer projects, so the detector is
 * mocked with hand-built multi-layer configs whose locale dirs point at
 * mkdtemp-created files (fixture-config route, cf. tests/fixtures/config.ts).
 */

const state = vi.hoisted(() => ({
  configs: new Map<string, unknown>(),
}))

vi.mock('../../src/config/detector.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/detector.js')>()
  return {
    ...original,
    detectI18nConfig: vi.fn(async (projectDir: string) => {
      const config = state.configs.get(projectDir)
      if (!config) throw new Error(`No fixture config for ${projectDir}`)
      return config as I18nConfig
    }),
    clearConfigCache: vi.fn(),
    getCachedConfig: vi.fn(() => null),
  }
})

const { findDuplicateKeys } = await import('../../src/core/operations.js')

const locales = [
  { code: 'de', file: 'de.json' },
  { code: 'en', file: 'en.json' },
]

/**
 * Multi-app temp project: a root layer shared by app-shop and app-admin,
 * both apps with a private layer. Mirrors the anny-ui motivating case:
 * root and app-shop define overlapping keys, one with divergent values.
 */
async function makeMultiLayerProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'i18n-dup-multi-'))
  const rootLocales = join(dir, 'i18n', 'locales')
  const shopLocales = join(dir, 'app-shop', 'i18n', 'locales')
  const adminLocales = join(dir, 'app-admin', 'i18n', 'locales')
  for (const d of [rootLocales, shopLocales, adminLocales]) {
    await mkdir(d, { recursive: true })
  }

  await writeFile(join(rootLocales, 'de.json'), JSON.stringify({
    common: { save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen' },
  }))
  await writeFile(join(rootLocales, 'en.json'), JSON.stringify({
    common: { save: 'Save', cancel: 'Cancel', delete: 'Delete' },
  }))
  // common.save identical to root (de), common.cancel divergent,
  // shop.checkout child-only. In en, common.save diverges too.
  await writeFile(join(shopLocales, 'de.json'), JSON.stringify({
    common: { save: 'Speichern', cancel: 'Verwerfen' },
    shop: { checkout: 'Zur Kasse' },
  }))
  await writeFile(join(shopLocales, 'en.json'), JSON.stringify({
    common: { save: 'Save!', cancel: 'Discard' },
    shop: { checkout: 'Checkout' },
  }))
  // No overlap with root.
  await writeFile(join(adminLocales, 'de.json'), JSON.stringify({
    admin: { title: 'Verwaltung' },
  }))

  const config: I18nConfig = {
    rootDir: dir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      { path: rootLocales, layer: 'root', layerRootDir: dir },
      { path: shopLocales, layer: 'app-shop', layerRootDir: join(dir, 'app-shop') },
      { path: adminLocales, layer: 'app-admin', layerRootDir: join(dir, 'app-admin') },
    ],
    layerRootDirs: [dir, join(dir, 'app-shop'), join(dir, 'app-admin')],
    apps: [
      { name: 'app-shop', rootDir: join(dir, 'app-shop'), layers: ['app-shop', 'root'] },
      { name: 'app-admin', rootDir: join(dir, 'app-admin'), layers: ['app-admin', 'root'] },
    ],
  }
  state.configs.set(dir, config)
  return dir
}

/** Degenerate project: one layer, no app info (generic/Laravel-style config). */
async function makeNoAppsProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'i18n-dup-noapps-'))
  const rootLocales = join(dir, 'i18n', 'locales')
  await mkdir(rootLocales, { recursive: true })
  await writeFile(join(rootLocales, 'de.json'), JSON.stringify({ greeting: 'Hallo' }))

  const config: I18nConfig = {
    rootDir: dir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      { path: rootLocales, layer: 'root', layerRootDir: dir },
    ],
    layerRootDirs: [dir],
    apps: [],
  }
  state.configs.set(dir, config)
  return dir
}

let multiDir: string
let noAppsDir: string

beforeAll(async () => {
  multiDir = await makeMultiLayerProject()
  noAppsDir = await makeNoAppsProject()
})

afterAll(async () => {
  await rm(multiDir, { recursive: true, force: true })
  await rm(noAppsDir, { recursive: true, force: true })
  state.configs.clear()
})

function asResult(result: Awaited<ReturnType<typeof findDuplicateKeys>>) {
  if ('reportFile' in result) throw new Error('Expected inline result, got report file')
  return result
}

describe('findDuplicateKeys — multi-layer collisions', () => {
  it('reports a collision with identical values as divergent: false', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir }))

    expect(result.collisions).toContainEqual({
      key: 'common.save',
      sharedLayer: 'root',
      childLayer: 'app-shop',
      sharedValue: 'Speichern',
      childValue: 'Speichern',
      divergent: false,
    })
  })

  it('reports a collision with divergent values as divergent: true, with both values', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir }))

    expect(result.collisions).toContainEqual({
      key: 'common.cancel',
      sharedLayer: 'root',
      childLayer: 'app-shop',
      sharedValue: 'Abbrechen',
      childValue: 'Verwerfen',
      divergent: true,
    })
  })

  it('does not report keys that exist only in the child layer', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir }))

    expect(result.collisions.map(c => c.key)).not.toContain('shop.checkout')
    // Shared-only keys are no collision either.
    expect(result.collisions.map(c => c.key)).not.toContain('common.delete')
  })

  it('summarizes collisions, divergence, checked pairs, and the locale used', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir }))

    // Pairs: (root, app-shop) and (root, app-admin); app-admin has no overlap.
    expect(result.summary).toEqual({
      totalCollisions: 2,
      divergentCount: 1,
      pairsChecked: 2,
      locale: 'de',
    })
  })

  it('compares in the requested locale instead of the default', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir, locale: 'en' }))

    expect(result.summary.locale).toBe('en')
    // In en, common.save diverges ('Save' vs 'Save!') unlike in de.
    expect(result.collisions).toContainEqual(
      expect.objectContaining({ key: 'common.save', divergent: true }),
    )
    expect(result.summary.divergentCount).toBe(2)
  })

  it('gives delete-one-side guidance, never moving', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: multiDir }))

    expect(result.guidance.toLowerCase()).toContain('shadow')
    expect(result.guidance.toLowerCase()).toContain('delet')
    expect(result.guidance.toLowerCase()).not.toContain('moving')
  })

  it('honors outputFile: writes the full report and returns only the summary', async () => {
    const reportPath = join(multiDir, 'duplicate-report.json')
    const result = await findDuplicateKeys({ projectDir: multiDir, outputFile: reportPath })

    expect(result).toEqual({
      reportFile: reportPath,
      summary: expect.objectContaining({ totalCollisions: 2, divergentCount: 1 }),
    })

    const report = JSON.parse(await readFile(reportPath, 'utf-8')) as Record<string, unknown>
    expect(report.tool).toBe('find_duplicate_keys')
    expect(report.collisions).toHaveLength(2)
  })
})

describe('findDuplicateKeys — degenerate config without app info', () => {
  it('reports each unordered pair once, with the wider layer as the shared side', async () => {
    // Make app-shop shared too: a third app consumes both root and app-shop.
    // Without unordered dedupe this reports every root↔app-shop collision
    // twice (once per direction).
    const dir = multiDir
    const config = structuredClone(state.configs.get(dir)) as I18nConfig
    config.apps!.push({
      name: 'app-outlook',
      rootDir: join(dir, 'app-outlook'),
      layers: ['app-shop', 'root'],
    })
    const symDir = `${dir}-sym`
    state.configs.set(symDir, config)
    try {
      const result = asResult(await findDuplicateKeys({ projectDir: symDir }))

      const pairIds = result.collisions.map(c => [c.sharedLayer, c.childLayer].sort().join('↔'))
      const keyPair = result.collisions.map(c => `${c.key}|${pairIds[0]}`)
      expect(new Set(keyPair).size).toBe(keyPair.length) // no direction duplicates
      // root is consumed by 3 apps, app-shop by 2 → root is the shared side
      for (const c of result.collisions.filter(c => c.childLayer === 'app-shop' || c.sharedLayer === 'app-shop')) {
        expect(c.sharedLayer).toBe('root')
      }
      expect(result.summary.totalCollisions).toBe(2) // same as without symmetry
    } finally {
      state.configs.delete(symDir)
    }
  })

  it('returns an empty result with a clear message instead of guessing pairs', async () => {
    const result = asResult(await findDuplicateKeys({ projectDir: noAppsDir }))

    expect(result.collisions).toEqual([])
    expect(result.summary.totalCollisions).toBe(0)
    expect(result.summary.pairsChecked).toBe(0)
    expect(result.summary.message).toContain('No app info')
  })
})
