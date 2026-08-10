/**
 * Scope-aware orphan operations end-to-end (#236): findOrphanKeys and
 * removeOrphanKeys over a multi-app temp project — misplacedUsages section,
 * per-layer scanScope in the summary, explicit-scanDirs override, and
 * removal never touching misplaced keys.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTempMultiAppConfig } from '../fixtures/config.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const { findOrphanKeys, removeOrphanKeys } = await import('../../src/core/operations.js')

let projectDir: string
let adminDir: string
let shopDir: string

const readLocale = async (dir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(dir, 'i18n/locales/de-DE.json'), 'utf-8'))

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-scope-ops-'))
  adminDir = join(projectDir, 'app-admin')
  shopDir = join(projectDir, 'app-shop')


  // Source files: root-layer code uses root key; app-admin uses its own and a
  // shared key; app-shop uses its own key plus an app-admin key (misplaced).
  await mkdir(join(projectDir, 'components'), { recursive: true })
  await writeFile(join(projectDir, 'components/Shared.vue'), `{{ $t('root.shared.used') }}`)
  await mkdir(join(adminDir, 'pages'), { recursive: true })
  await writeFile(join(adminDir, 'pages/index.vue'), [
    `{{ $t('admin.used') }}`,
    `{{ $t('root.shared.usedByAdmin') }}`,
  ].join('\n'))
  await mkdir(join(shopDir, 'pages'), { recursive: true })
  await writeFile(join(shopDir, 'pages/index.vue'), [
    `{{ $t('shop.used') }}`,
    `{{ $t('admin.usedFromShop') }}`,
  ].join('\n'))

  holder.config = createTempMultiAppConfig(projectDir)
})

// Fresh locale contents per test: the destructive removeOrphanKeys case
// mutates them, and the suite must not be order-dependent.
beforeEach(async () => {
  await mkdir(join(projectDir, 'i18n/locales'), { recursive: true })
  await writeFile(join(projectDir, 'i18n/locales/de-DE.json'), JSON.stringify({
    root: { shared: { used: 'a', usedByAdmin: 'b', orphan: 'c' } },
  }))
  await mkdir(join(adminDir, 'i18n/locales'), { recursive: true })
  await writeFile(join(adminDir, 'i18n/locales/de-DE.json'), JSON.stringify({
    admin: { used: 'a', usedFromShop: 'b', orphan: 'c' },
  }))
  await mkdir(join(shopDir, 'i18n/locales'), { recursive: true })
  await writeFile(join(shopDir, 'i18n/locales/de-DE.json'), JSON.stringify({
    shop: { used: 'a' },
  }))
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
})

const expectedOrphans = {
  'app-admin': ['admin.orphan'],
  'root': ['root.shared.orphan'],
}
const expectedMisplaced = [
  { key: 'admin.usedFromShop', layer: 'app-admin', usingApps: ['app-shop'] },
]

describe('findOrphanKeys — scope-aware', () => {
  it('reports scoped orphans, misplaced usages, and per-layer scan scope', async () => {
    const result = await findOrphanKeys({ projectDir })

    expect(result.orphanKeys).toEqual(expectedOrphans)
    expect(result.misplacedUsages).toEqual(expectedMisplaced)
    expect(result.misplacedUsageNote).toMatch(/broader.*layer|usage is a bug/)

    const summary = result.summary as Record<string, unknown>
    expect(summary.orphanCount).toBe(2)
    expect(summary.misplacedCount).toBe(1)
    // 7 keys total: 4 used, 2 orphans, 1 misplaced.
    expect(summary.totalKeys).toBe(7)
    expect(summary.usedCount).toBe(4)

    const scanScope = summary.scanScope as Record<string, string[]>
    expect(scanScope['app-admin']).toEqual(['app-admin'])
    expect(scanScope['app-shop']).toEqual(['app-shop'])
    expect(scanScope['root']?.sort()).toEqual(['.', 'app-admin', 'app-shop'])
  })

  it('explicit scanDirs keeps the global behavior — no misplaced findings', async () => {
    const result = await findOrphanKeys({ projectDir, scanDirs: [projectDir] })

    expect(result.orphanKeys).toEqual(expectedOrphans)
    expect(result.misplacedUsages).toBeUndefined()

    const summary = result.summary as Record<string, unknown>
    expect(summary.misplacedCount).toBe(0)
    expect(summary.usedCount).toBe(5)
    expect((summary.scanScope as Record<string, string[]>)['app-admin']).toEqual(['.'])
  })
})

describe('removeOrphanKeys — scope-aware', () => {
  it('dry run (default) reports scoped orphans and misplaced usages without writing', async () => {
    const result = await removeOrphanKeys({ projectDir })

    const summary = result.summary as Record<string, unknown>
    expect(summary.dryRun).toBe(true)
    expect(result.orphanKeys).toEqual(expectedOrphans)
    expect(result.misplacedUsages).toEqual(expectedMisplaced)
    expect(summary.misplacedCount).toBe(1)
    expect((summary.scanScope as Record<string, string[]>)['app-admin']).toEqual(['app-admin'])
    expect(summary.message).toContain('misplacedUsages')

    // Nothing removed.
    expect(await readLocale(adminDir)).toEqual({ admin: { used: 'a', usedFromShop: 'b', orphan: 'c' } })
  })

  it('dryRun: false removes orphans but never misplaced keys', async () => {
    const result = await removeOrphanKeys({ projectDir, dryRun: false })

    expect(result.removed).toEqual(expectedOrphans)
    expect(result.misplacedUsages).toEqual(expectedMisplaced)

    // Misplaced key survives; orphans are gone.
    expect(await readLocale(adminDir)).toEqual({ admin: { used: 'a', usedFromShop: 'b' } })
    expect(await readLocale(projectDir)).toEqual({ root: { shared: { used: 'a', usedByAdmin: 'b' } } })
    expect(await readLocale(shopDir)).toEqual({ shop: { used: 'a' } })
  })
})
