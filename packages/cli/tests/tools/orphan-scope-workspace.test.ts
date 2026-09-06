/**
 * Scope-aware orphan detection over an inferred consumer graph: the same
 * misplaced-usage reporting `orphan-scope.test.ts` covers for Nuxt, but on a
 * generic-adapter monorepo whose apps come from workspace dependency edges.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectI18nConfig, clearConfigCache } from '../../src/config/detector.js'
import { findOrphanKeys } from '../../src/core/operations.js'

let projectDir: string

async function write(relativePath: string, contents: string): Promise<void> {
  const path = join(projectDir, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf-8')
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-workspace-orphans-'))
  clearConfigCache()

  await write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n")
  await write('package.json', json({ name: 'monorepo-root', private: true }))
  await write('.i18n-mcp.json', json({
    defaultLocale: 'en',
    localeDirs: [
      { path: 'apps/shop/locales', layer: 'shop' },
      { path: 'apps/admin/locales', layer: 'admin' },
      { path: 'packages/ui/locales', layer: 'ui' },
      { path: 'packages/shared-i18n/locales', layer: 'shared' },
    ],
  }))

  // shop depends on the UI kit and the shared locale package; admin only on
  // the shared one — so admin cannot legitimately render a `ui.*` key.
  await write('apps/shop/package.json', json({
    name: 'shop',
    dependencies: { ui: 'workspace:*', 'shared-i18n': 'workspace:*' },
  }))
  await write('apps/admin/package.json', json({
    name: 'admin',
    dependencies: { 'shared-i18n': 'workspace:*' },
  }))
  await write('packages/ui/package.json', json({ name: 'ui' }))
  await write('packages/shared-i18n/package.json', json({ name: 'shared-i18n' }))

  await write('apps/shop/locales/en.json', json({ shop: { used: 'a' } }))
  await write('apps/admin/locales/en.json', json({ admin: { used: 'a' } }))
  await write('packages/ui/locales/en.json', json({ ui: { used: 'a', onlyAdmin: 'b' } }))
  await write('packages/shared-i18n/locales/en.json', json({ shared: { used: 'a' } }))

  await write('apps/shop/pages/index.vue', [
    `{{ $t('shop.used') }}`,
    `{{ $t('ui.used') }}`,
    `{{ $t('shared.used') }}`,
  ].join('\n'))
  await write('apps/admin/pages/index.vue', [
    `{{ $t('admin.used') }}`,
    `{{ $t('shared.used') }}`,
    // Defined in a layer admin does not consume: misplaced, not orphaned.
    `{{ $t('ui.onlyAdmin') }}`,
  ].join('\n'))
})

afterAll(async () => {
  clearConfigCache()
  await rm(projectDir, { recursive: true, force: true })
})

describe('findOrphanKeys over a workspace-inferred consumer graph', () => {
  it('infers one app per workspace root package', async () => {
    const config = await detectI18nConfig(projectDir)

    expect(config.apps.map(app => ({ name: app.name, layers: app.layers }))).toEqual([
      { name: 'admin', layers: ['admin', 'shared'] },
      { name: 'shop', layers: ['shop', 'ui', 'shared'] },
    ])
  })

  it('reports a key used only from a non-consuming app as misplaced, not orphaned', async () => {
    const result = await findOrphanKeys({ projectDir })

    expect(result.misplacedUsages).toEqual([
      { key: 'ui.onlyAdmin', layer: 'ui', usingApps: ['admin'] },
    ])
    expect(result.orphanKeys).toEqual({})
    expect(JSON.stringify(result.orphanKeys)).not.toContain('onlyAdmin')
  })
})
