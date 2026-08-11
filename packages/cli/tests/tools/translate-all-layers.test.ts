/**
 * All-layers translate over a multi-app config WITH an alias layer
 * (app-outlook reuses app-shop's locale dir): the physical dir behind an
 * alias must be translated exactly once. Complements the seam tests, which
 * cover all-layers aggregation through the real generic adapter (no aliases
 * there — only the Nuxt adapter emits aliasOf entries).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { I18nConfig } from '../../src/config/types.js'
import { createTempMultiAppConfig } from '../fixtures/config.js'
import { countingTranslator } from '../fixtures/translate-harness.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const { translateMissing } = await import('../../src/core/operations.js')

let projectDir: string

/** Locale dirs by layer, alias included (it points at app-shop's dir). */
const dirs = (root: string) => ({
  'root': join(root, 'i18n/locales'),
  'app-admin': join(root, 'app-admin/i18n/locales'),
  'app-shop': join(root, 'app-shop/i18n/locales'),
})

/**
 * createTempMultiAppConfig plus an en locale and the alias entry from
 * createMultiAppConfig: app-outlook has no own locale dir — it reuses
 * app-shop's (aliasOf: 'app-shop').
 */
function createAliasedConfig(root: string): I18nConfig {
  const config = createTempMultiAppConfig(root)
  config.locales = [
    { code: 'de', language: 'de-DE', file: 'de-DE.json' },
    { code: 'en', language: 'en-US', file: 'en-US.json' },
  ]
  const outlookDir = resolve(root, 'app-outlook')
  config.localeDirs.push({
    path: resolve(root, 'app-shop/i18n/locales'),
    layer: 'app-outlook',
    layerRootDir: outlookDir,
    aliasOf: 'app-shop',
  })
  config.apps.push({ name: 'app-outlook', rootDir: outlookDir, layers: ['app-outlook', 'root'] })
  return config
}

const seedByLayer: Record<string, Record<string, unknown>> = {
  'root': { common: { save: 'Speichern', cancel: 'Abbrechen', delete: 'Löschen' } },
  'app-admin': { admin: { title: 'Verwaltung', users: 'Benutzer' } },
  'app-shop': { shop: { checkout: 'Zur Kasse' } },
}

async function readEn(layer: keyof ReturnType<typeof dirs>): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dirs(projectDir)[layer], 'en-US.json'), 'utf-8')) as Record<string, unknown>
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-all-layers-'))
  for (const [layer, dir] of Object.entries(dirs(projectDir))) {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'de-DE.json'), JSON.stringify(seedByLayer[layer]))
    await writeFile(join(dir, 'en-US.json'), '{}\n')
  }
  holder.config = createAliasedConfig(projectDir)
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
})

describe('translateMissing all-layers with an alias layer', () => {
  it('translates each physical dir once — the alias never appears and never causes extra provider calls', async () => {
    const { fn, calls } = countingTranslator()
    const result = (await translateMissing({ projectDir, translateFn: fn })) as any

    // Canonical layers only, in localeDirs order — app-outlook is absent.
    expect(result.summary.layers).toEqual(['root', 'app-admin', 'app-shop'])
    expect(result.summary.byLayer.map((l: { layer: string }) => l.layer))
      .toEqual(['root', 'app-admin', 'app-shop'])
    expect(result.layers['app-outlook']).toBeUndefined()

    // One batch per layer (single target locale, all under batch size):
    // a fourth call would mean the aliased dir was translated twice.
    expect(calls).toHaveLength(3)
    expect(calls.map(batch => Object.keys(batch).length).sort()).toEqual([1, 2, 3])

    expect(result.summary.totalTranslated).toBe(6)
    expect(result.summary.byLayer).toEqual([
      { layer: 'root', totalTranslated: 3, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 0 },
      { layer: 'app-admin', totalTranslated: 2, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 0 },
      { layer: 'app-shop', totalTranslated: 1, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 0 },
    ])

    expect(await readEn('root')).toMatchObject({ common: { save: '[t] Speichern' } })
    expect(await readEn('app-admin')).toMatchObject({ admin: { users: '[t] Benutzer' } })
    expect(await readEn('app-shop')).toMatchObject({ shop: { checkout: '[t] Zur Kasse' } })
  })

  it('does not double-count the aliased dir in dry-run totals', async () => {
    // Dry runs write nothing, so a duplicated alias layer would inflate
    // totalWouldTranslate — the strongest observable dedupe signal.
    const result = (await translateMissing({ projectDir, dryRun: true })) as any

    expect(result.summary.totalWouldTranslate).toBe(6)
    expect(result.summary.byLayer).toEqual([
      { layer: 'root', totalTranslated: 0, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 3 },
      { layer: 'app-admin', totalTranslated: 0, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 2 },
      { layer: 'app-shop', totalTranslated: 0, totalFailed: 0, totalSkipped: 0, totalWouldTranslate: 1 },
    ])
    expect(await readEn('app-shop')).toEqual({})
  })

  it('holds the missing invariant per locale in every layer section and globally', async () => {
    const { fn } = countingTranslator()
    const result = (await translateMissing({ projectDir, translateFn: fn })) as any

    let globalAccounted = 0
    let globalMissing = 0
    for (const section of Object.values(result.layers) as Array<{ results: Record<string, any> }>) {
      for (const r of Object.values(section.results)) {
        expect(r.missing).toBe(
          r.translated.length + (r.wouldTranslate?.length ?? 0) + r.failed.length + r.skipped.length,
        )
        globalMissing += r.missing
        globalAccounted += r.translated.length + (r.wouldTranslate?.length ?? 0) + r.failed.length + r.skipped.length
      }
    }
    expect(globalMissing).toBe(6)
    expect(globalAccounted).toBe(
      result.summary.totalTranslated + result.summary.totalFailed + result.summary.totalSkipped,
    )
  })
})
