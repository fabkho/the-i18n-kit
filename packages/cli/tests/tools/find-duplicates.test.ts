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
const { runOperation } = await import('../fixtures/surface.js')

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


/** Minimal two-layer temp project (root + app-shop) for focused cases. */
async function makeTwoLayerProject(
  prefix: string,
  rootDe: Record<string, unknown> | string,
  shopDe: Record<string, unknown> | string,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const rootLocales = join(dir, 'i18n', 'locales')
  const shopLocales = join(dir, 'app-shop', 'i18n', 'locales')
  await mkdir(rootLocales, { recursive: true })
  await mkdir(shopLocales, { recursive: true })
  await writeFile(join(rootLocales, 'de.json'), typeof rootDe === 'string' ? rootDe : JSON.stringify(rootDe))
  await writeFile(join(shopLocales, 'de.json'), typeof shopDe === 'string' ? shopDe : JSON.stringify(shopDe))
  state.configs.set(dir, {
    rootDir: dir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      { path: rootLocales, layer: 'root', layerRootDir: dir },
      { path: shopLocales, layer: 'app-shop', layerRootDir: join(dir, 'app-shop') },
    ],
    layerRootDirs: [dir, join(dir, 'app-shop')],
    apps: [{ name: 'app-shop', rootDir: join(dir, 'app-shop'), layers: ['app-shop', 'root'] }],
  } as I18nConfig)
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

describe('findDuplicateKeys — multi-layer collisions', () => {
  it('reports a collision with identical values as divergent: false', async () => {
    const result = await findDuplicateKeys({ projectDir: multiDir })

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
    const result = await findDuplicateKeys({ projectDir: multiDir })

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
    const result = await findDuplicateKeys({ projectDir: multiDir })

    expect(result.collisions.map(c => c.key)).not.toContain('shop.checkout')
    // Shared-only keys are no collision either.
    expect(result.collisions.map(c => c.key)).not.toContain('common.delete')
  })

  it('summarizes collisions, divergence, checked pairs, and the locale used', async () => {
    const result = await findDuplicateKeys({ projectDir: multiDir })

    // Pairs: (root, app-shop) and (root, app-admin); app-admin has no overlap.
    expect(result.summary).toEqual({
      totalCollisions: 2,
      divergentCount: 1,
      pairsChecked: 2,
      locale: 'de',
    })
  })

  it('compares in the requested locale instead of the default', async () => {
    const result = await findDuplicateKeys({ projectDir: multiDir, locale: 'en' })

    expect(result.summary.locale).toBe('en')
    // In en, common.save diverges ('Save' vs 'Save!') unlike in de.
    expect(result.collisions).toContainEqual(
      expect.objectContaining({ key: 'common.save', divergent: true }),
    )
    expect(result.summary.divergentCount).toBe(2)
  })

  it('gives delete-one-side guidance, never moving', async () => {
    const result = await findDuplicateKeys({ projectDir: multiDir })

    expect(result.guidance.toLowerCase()).toContain('shadow')
    expect(result.guidance.toLowerCase()).toContain('delet')
    expect(result.guidance.toLowerCase()).not.toContain('moving')
  })

  // The file is the surface's doing, so this asks for one the way a surface does.
  it('honors outputFile: writes the full report and returns only the summary', async () => {
    const reportPath = join(multiDir, 'duplicate-report.json')
    const result = await runOperation('find-duplicates', { projectDir: multiDir, outputFile: reportPath })

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
      const result = await findDuplicateKeys({ projectDir: symDir })

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

  it('compares non-primitive leaf values structurally, not by reference', async () => {
    const dir = await makeTwoLayerProject('i18n-dup-arrays-',
      { list: { equal: ['a', 'b'], different: ['x'] } },
      { list: { equal: ['a', 'b'], different: ['y'] } })
    try {
      const result = await findDuplicateKeys({ projectDir: dir })
      expect(result.collisions).toContainEqual(
        expect.objectContaining({ key: 'list.equal', divergent: false }),
      )
      expect(result.collisions).toContainEqual(
        expect.objectContaining({ key: 'list.different', divergent: true }),
      )
    } finally {
      state.configs.delete(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('propagates malformed locale data instead of treating it as empty', async () => {
    const dir = await makeTwoLayerProject('i18n-dup-malformed-',
      '{ this is not JSON',
      { a: 'b' })
    try {
      await expect(findDuplicateKeys({ projectDir: dir })).rejects.toThrow()
    } finally {
      state.configs.delete(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('derives shared/child from app layer precedence, not consumer counts', async () => {
    // "big" is consumed by three apps, "small" by one — a consumer-count
    // heuristic would call big the shared side. But the app that consumes
    // both lists big FIRST (big overrides small at runtime), so big is the
    // child and small the shared base.
    const dir = multiDir
    const config = structuredClone(state.configs.get(dir)) as I18nConfig
    config.apps = [
      { name: 'app-a', rootDir: join(dir, 'a'), layers: ['app-shop', 'root'] }, // app-shop = big, first = overriding
      { name: 'app-b', rootDir: join(dir, 'b'), layers: ['app-shop'] },
      { name: 'app-c', rootDir: join(dir, 'c'), layers: ['app-shop'] },
    ]
    const precDir = `${dir}-prec`
    state.configs.set(precDir, config)
    try {
      const result = await findDuplicateKeys({ projectDir: precDir })
      expect(result.summary.pairsChecked).toBe(1)
      for (const c of result.collisions) {
        expect(c.childLayer).toBe('app-shop') // big overrides → child
        expect(c.sharedLayer).toBe('root') // small is the base → shared
      }
      expect(result.collisions.length).toBeGreaterThan(0)
    } finally {
      state.configs.delete(precDir)
    }
  })

  it('returns an empty result with a clear message instead of guessing pairs', async () => {
    const result = await findDuplicateKeys({ projectDir: noAppsDir })

    expect(result.collisions).toEqual([])
    expect(result.summary.totalCollisions).toBe(0)
    expect(result.summary.pairsChecked).toBe(0)
    expect(result.summary.message).toContain('No app info')
  })
})

/**
 * Value-level duplication (#343): different key paths carrying the same value,
 * which key-path collision detection cannot see at all. The motivating case is
 * two app-layer keys re-implementing a root key that already exists — each then
 * translated into every locale separately, so the duplication costs provider
 * spend on every run.
 */
describe('findDuplicateKeys — value duplicates', () => {
  /** The real anny-ui shape: one root key, two app keys, all "Speichern". */
  async function makeValueDuplicateProject(): Promise<string> {
    return makeTwoLayerProject(
      'i18n-dup-value-',
      { common: { actions: { save: 'Speichern' } }, greeting: 'Willkommen' },
      {
        bookingCreator: { orderDetails: { save: 'Speichern' } },
        calendar: { views: { save: 'Speichern ' } },
        yes: 'Ja',
        alsoYes: 'Ja',
      },
    )
  }

  it('is absent unless asked for, so the existing result shape is untouched', async () => {
    const result = await findDuplicateKeys({ projectDir: multiDir })

    expect(result.valueDuplicates).toBeUndefined()
    expect(result.summary.valueGroups).toBeUndefined()
  })

  it('groups keys that carry the same value across layers', async () => {
    const dir = await makeValueDuplicateProject()
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })
      const group = result.valueDuplicates?.find(g => g.normalized === 'speichern')

      expect(group?.members.map(m => m.key).sort()).toEqual([
        'bookingCreator.orderDetails.save',
        'calendar.views.save',
        'common.actions.save',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The fix here costs nothing but deletions, which is why it sorts first.
  it('calls a group reuse when a shared layer already carries the value', async () => {
    const dir = await makeValueDuplicateProject()
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.valueDuplicates?.[0]?.action).toBe('reuse')
      expect(result.valueDuplicates?.[0]?.members.filter(m => m.shared)).toHaveLength(1)
      expect(result.summary.reusableGroups).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('folds trailing whitespace, case and punctuation into one group', async () => {
    const dir = await makeTwoLayerProject(
      'i18n-dup-norm-',
      { a: { save: 'Speichern' } },
      { b: { save: 'speichern. ' } },
    )
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.valueDuplicates).toHaveLength(1)
      expect(result.valueDuplicates?.[0]?.members).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('folds a run of internal whitespace, which a copy-paste leaves behind', async () => {
    const dir = await makeTwoLayerProject(
      'i18n-dup-inner-ws-',
      { a: { save: 'Jetzt  speichern' } },
      { b: { save: 'Jetzt speichern' } },
    )
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.valueDuplicates).toHaveLength(1)
      expect(result.valueDuplicates?.[0]?.normalized).toBe('jetzt speichern')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The pair-wise check already reports this key, with both values. Repeating
  // it as a value duplicate would say nothing new and inflate the count.
  it('leaves one key path defined in two layers to the collision report', async () => {
    const dir = await makeTwoLayerProject(
      'i18n-dup-same-key-',
      { common: { save: 'Speichern' } },
      { common: { save: 'Speichern' } },
    )
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.collisions.map(c => c.key)).toEqual(['common.save'])
      expect(result.valueDuplicates).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // Comparing a length against NaN is always false, so a mistyped floor would
  // silently remove the floor — the opposite of what asking for one means.
  it('refuses a floor that is not a usable number instead of ignoring it', async () => {
    const dir = await makeValueDuplicateProject()
    try {
      await expect(findDuplicateKeys({ projectDir: dir, byValue: true, minValueLength: Number('abc') }))
        .rejects.toThrow(/minValueLength/)
      await expect(findDuplicateKeys({ projectDir: dir, byValue: true, minValueLength: -1 }))
        .rejects.toThrow(/minValueLength/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // "Ja" repeating across unrelated namespaces is not a finding, and reporting
  // it buries the ones worth acting on.
  it('leaves short values alone, and takes a floor from the caller', async () => {
    const dir = await makeValueDuplicateProject()
    try {
      const byDefault = await findDuplicateKeys({ projectDir: dir, byValue: true })
      expect(byDefault.valueDuplicates?.some(g => g.normalized === 'ja')).toBe(false)

      const withFloor = await findDuplicateKeys({ projectDir: dir, byValue: true, minValueLength: 2 })
      expect(withFloor.valueDuplicates?.some(g => g.normalized === 'ja')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a value duplicated inside one layer as a consolidation', async () => {
    const dir = await makeTwoLayerProject(
      'i18n-dup-same-layer-',
      { a: { save: 'Speichern' }, b: { store: 'Speichern' } },
      { unrelated: { title: 'Etwas anderes' } },
    )
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.valueDuplicates?.[0]?.action).toBe('consolidate')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('says nothing about a value that appears once', async () => {
    const dir = await makeTwoLayerProject(
      'i18n-dup-unique-',
      { a: { save: 'Speichern' } },
      { b: { cancel: 'Abbrechen' } },
    )
    try {
      const result = await findDuplicateKeys({ projectDir: dir, byValue: true })

      expect(result.valueDuplicates).toEqual([])
      expect(result.summary.valueGroups).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
