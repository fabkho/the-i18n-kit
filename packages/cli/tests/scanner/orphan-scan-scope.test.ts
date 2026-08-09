/**
 * Scope-aware orphan scanning (#236).
 *
 * Covers the scan plan built from the layer graph (per-app usage sets,
 * degenerate fallbacks, project-root remainder unit) and the scoped checking
 * in findOrphanKeysForConfig: per-layer scope, misplaced-usage detection,
 * explicit-scanDirs global behavior, and once-per-file nested scanning.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { findOrphanKeysForConfig } from '../../src/scanner/code-scanner.js'
import type { OrphanScanOptions } from '../../src/scanner/code-scanner.js'
import { buildOrphanScanPlan } from '../../src/core/ops-orphans.js'
import type { I18nConfig } from '../../src/config/types.js'
import { createMultiAppConfig, createNoAppsConfig, createTempMultiAppConfig } from '../fixtures/config.js'

// ─── Scan plan from the layer graph ─────────────────────────────

describe('buildOrphanScanPlan', () => {
  it('multi-app config: one unit per distinct app/layer dir, scoped per consuming apps', () => {
    const config = createMultiAppConfig()
    const plan = buildOrphanScanPlan(config, config.rootDir)

    const unitNames = plan.units.map(u => u.name).sort()
    expect(unitNames).toEqual(['app-admin', 'app-outlook', 'app-shop', 'root'])

    // root is consumed by every app; its own layer dir also vouches.
    expect(plan.scopeByLayer.get('root')?.sort()).toEqual(['app-admin', 'app-outlook', 'app-shop', 'root'])
    // App-private layer: its own app only.
    expect(plan.scopeByLayer.get('app-admin')).toEqual(['app-admin'])
    // Alias consumption resolves to the owner: app-outlook vouches for app-shop keys.
    expect(plan.scopeByLayer.get('app-shop')?.sort()).toEqual(['app-outlook', 'app-shop'])
  })

  it('no app info: every layer falls back to ALL units (degenerate semantics)', () => {
    const config = createNoAppsConfig()
    const plan = buildOrphanScanPlan(config, config.rootDir)

    expect(plan.units.map(u => u.name)).toEqual(['default'])
    expect(plan.scopeByLayer.get('default')).toEqual(['default'])
  })

  it('project dir outside every unit: adds a project-root unit that counts for every layer', () => {
    const config = createMultiAppConfig()
    const outsideRoot = resolve(config.rootDir, '../..')
    const plan = buildOrphanScanPlan(config, outsideRoot)

    const projectUnit = plan.units.find(u => u.dir === outsideRoot)
    expect(projectUnit?.name).toBe('project-root')
    expect(plan.scopeByLayer.get('app-admin')).toContain('project-root')
    expect(plan.scopeByLayer.get('root')).toContain('project-root')
  })

  it('project dir covered by a unit: no synthetic project-root unit', () => {
    const config = createMultiAppConfig()
    const plan = buildOrphanScanPlan(config, config.rootDir)
    expect(plan.units.some(u => u.name === 'project-root')).toBe(false)
  })
})

// ─── Scoped checking against a real source tree ─────────────────

describe('findOrphanKeysForConfig — scope-aware plan', () => {
  let projectDir: string
  let adminDir: string
  let shopDir: string
  let config: I18nConfig

  const keysByLayer = () => new Map([
    ['root', {
      keys: ['root.shared.used', 'root.shared.usedByAdmin', 'root.shared.orphan'],
      localeDir: { layer: 'root' },
    }],
    ['app-admin', {
      keys: ['admin.used', 'admin.usedFromShop', 'admin.fromRoot', 'admin.dyn.one', 'admin.orphan'],
      localeDir: { layer: 'app-admin' },
    }],
    ['app-shop', {
      keys: ['shop.used'],
      localeDir: { layer: 'app-shop' },
    }],
  ])

  const scanOptions = (overrides?: Partial<OrphanScanOptions>): OrphanScanOptions => ({
    keysByLayer: keysByLayer(),
    scanPlan: buildOrphanScanPlan(config, projectDir),
    resolveIgnorePatterns: () => undefined,
    ...overrides,
  })

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-scope-scan-'))
    adminDir = join(projectDir, 'app-admin')
    shopDir = join(projectDir, 'app-shop')

    // Root-layer code (outside both app dirs): uses a root key and — the
    // misplaced case — an app-admin key.
    await mkdir(join(projectDir, 'components'), { recursive: true })
    await writeFile(join(projectDir, 'components/Shared.vue'), [
      `{{ $t('root.shared.used') }}`,
      `{{ $t('admin.fromRoot') }}`,
    ].join('\n'))

    // app-admin uses its own key and a shared root key.
    await mkdir(join(adminDir, 'pages'), { recursive: true })
    await writeFile(join(adminDir, 'pages/index.vue'), [
      `{{ $t('admin.used') }}`,
      `{{ $t('root.shared.usedByAdmin') }}`,
    ].join('\n'))

    // app-shop uses its own key, an app-admin key statically (misplaced),
    // and an app-admin key via a dynamic template (misplaced via pattern).
    await mkdir(join(shopDir, 'pages'), { recursive: true })
    await writeFile(join(shopDir, 'pages/index.vue'), [
      `{{ $t('shop.used') }}`,
      `{{ $t('admin.usedFromShop') }}`,
      'const label = t(`admin.dyn.${variant}`)',
    ].join('\n'))

    config = createTempMultiAppConfig(projectDir)
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('scans each file exactly once despite nested unit dirs', async () => {
    const result = await findOrphanKeysForConfig(scanOptions())
    expect(result.totalFilesScanned).toBe(3)
  })

  it('shared-layer keys are vouched for by any consuming app', async () => {
    const result = await findOrphanKeysForConfig(scanOptions())
    // Used in root-layer code and in app-admin code respectively.
    expect(result.orphansByLayer['root']).toEqual(['root.shared.orphan'])
  })

  it('app-layer key used only from non-consuming units is misplaced, not orphan or used', async () => {
    const result = await findOrphanKeysForConfig(scanOptions())

    expect(result.orphansByLayer['app-admin']).toEqual(['admin.orphan'])
    expect(result.misplacedUsages).toEqual([
      { key: 'admin.dyn.one', layer: 'app-admin', usingApps: ['app-shop'] },
      { key: 'admin.fromRoot', layer: 'app-admin', usingApps: ['root'] },
      { key: 'admin.usedFromShop', layer: 'app-admin', usingApps: ['app-shop'] },
    ])
    // Not double-reported as orphans.
    const orphanKeys = Object.values(result.orphansByLayer).flat()
    for (const m of result.misplacedUsages) {
      expect(orphanKeys).not.toContain(m.key)
    }
  })

  it('reports each layer\'s effective scan scope', async () => {
    const result = await findOrphanKeysForConfig(scanOptions())

    expect(result.scanScopeByLayer['root']?.sort()).toEqual([adminDir, shopDir, projectDir].sort())
    expect(result.scanScopeByLayer['app-admin']).toEqual([adminDir])
    expect(result.scanScopeByLayer['app-shop']).toEqual([shopDir])
  })

  it('explicit scanDirs restores the global combined-scan behavior', async () => {
    const result = await findOrphanKeysForConfig(scanOptions({
      scanDirs: [projectDir],
      scanPlan: undefined,
    }))

    // Cross-app usages count as "used" — no misplaced findings.
    expect(result.misplacedUsages).toEqual([])
    expect(result.orphansByLayer['app-admin']).toEqual(['admin.orphan'])
    expect(result.orphansByLayer['root']).toEqual(['root.shared.orphan'])
    // Every layer's scope is the explicit dir list.
    expect(result.scanScopeByLayer['app-admin']).toEqual([projectDir])
    expect(result.dirsScanned).toEqual([projectDir])
  })

  it('degenerate no-app plan produces results identical to the global scan', async () => {
    const noAppsConfig: I18nConfig = { ...config, apps: [] }
    const planned = await findOrphanKeysForConfig(scanOptions({
      scanPlan: buildOrphanScanPlan(noAppsConfig, projectDir),
    }))
    const global = await findOrphanKeysForConfig(scanOptions({
      scanDirs: [projectDir],
      scanPlan: undefined,
    }))

    expect(planned.orphansByLayer).toEqual(global.orphansByLayer)
    expect(planned.uncertainByLayer).toEqual(global.uncertainByLayer)
    expect(planned.orphanCount).toBe(global.orphanCount)
    expect(planned.uncertainCount).toBe(global.uncertainCount)
    expect(planned.dynamicMatchedCount).toBe(global.dynamicMatchedCount)
    expect(planned.ignoredCount).toBe(global.ignoredCount)
    expect(planned.totalFilesScanned).toBe(global.totalFilesScanned)
    expect(planned.misplacedUsages).toEqual([])
  })
})
