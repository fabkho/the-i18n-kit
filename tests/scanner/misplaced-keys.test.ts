import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findMisplacedKeysForConfig } from '../../src/scanner/code-scanner.js'
import type { AppInfo } from '../../src/config/types.js'

const tmpDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp-test/misplaced')

async function createFile(relativePath: string, content: string) {
  const fullPath = join(tmpDir, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

describe('findMisplacedKeysForConfig', () => {
  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true })

    // root layer source files
    await createFile('root/components/SharedComponent.vue', `
      <template>{{ $t('shared.title') }}</template>
      <script setup>
      const label = t('shared.actions.save')
      const onlyRoot = t('root.only.here')
      </script>
    `)

    // app-admin source files
    await createFile('app-admin/pages/Dashboard.vue', `
      <template>{{ $t('admin.dashboard.title') }}</template>
      <script setup>
      const x = t('admin.settings.label')
      const shared = t('shared.title')
      </script>
    `)

    // app-shop source files
    await createFile('app-shop/pages/Products.vue', `
      <template>{{ $t('shop.products.title') }}</template>
      <script setup>
      const y = t('shared.title')
      const childOnly = t('child.in.root')
      </script>
    `)
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  const apps: AppInfo[] = [
    { name: 'root', rootDir: join(tmpDir, 'root'), layers: [] },
    { name: 'app-admin', rootDir: join(tmpDir, 'app-admin'), layers: ['root'] },
    { name: 'app-shop', rootDir: join(tmpDir, 'app-shop'), layers: ['root'] },
  ]

  it('returns empty for single-app projects', async () => {
    const result = await findMisplacedKeysForConfig({
      keysByLayer: new Map([['root', { keys: ['some.key'], localeDir: { layer: 'root' } }]]),
      apps: [{ name: 'root', rootDir: join(tmpDir, 'root'), layers: [] }],
      resolveIgnorePatterns: () => undefined,
    })
    expect(result.misplacedKeys).toEqual([])
    expect(result.summary.total).toBe(0)
  })

  it('detects child key used from root (child → root)', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['shared.title', 'admin.dashboard.title'], localeDir: { layer: 'app-admin' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    const misplaced = result.misplacedKeys.find(m => m.key === 'shared.title')
    expect(misplaced).toBeDefined()
    expect(misplaced!.currentLayer).toBe('app-admin')
    expect(misplaced!.suggestedLayer).toBe('root')
    expect(misplaced!.usedIn).toContain('root')
  })

  it('does not flag child key used only by its own layer', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['admin.dashboard.title', 'admin.settings.label'], localeDir: { layer: 'app-admin' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    const flagged = result.misplacedKeys.filter(m => m.key.startsWith('admin.'))
    expect(flagged).toEqual([])
  })

  it('detects root key used only by one child (root → child)', async () => {
    const keysByLayer = new Map([
      ['root', { keys: ['child.in.root', 'shared.title', 'root.only.here'], localeDir: { layer: 'root' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    const misplaced = result.misplacedKeys.find(m => m.key === 'child.in.root')
    expect(misplaced).toBeDefined()
    expect(misplaced!.currentLayer).toBe('root')
    expect(misplaced!.suggestedLayer).toBe('app-shop')
    expect(misplaced!.usedIn).toEqual(['app-shop'])
  })

  it('does not flag root key used by root itself', async () => {
    const keysByLayer = new Map([
      ['root', { keys: ['root.only.here'], localeDir: { layer: 'root' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    expect(result.misplacedKeys).toEqual([])
  })

  it('does not flag root key used by multiple children', async () => {
    const keysByLayer = new Map([
      ['root', { keys: ['shared.title'], localeDir: { layer: 'root' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    const flagged = result.misplacedKeys.find(m => m.key === 'shared.title')
    expect(flagged).toBeUndefined()
  })

  it('flags child key used by another child (not just root)', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['shared.title'], localeDir: { layer: 'app-admin' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    const misplaced = result.misplacedKeys.find(m => m.key === 'shared.title')
    expect(misplaced).toBeDefined()
    expect(misplaced!.suggestedLayer).toBe('root')
    expect(misplaced!.usedIn).toContain('app-shop')
  })

  it('respects ignorePatterns', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['shared.title', 'shared.actions.save'], localeDir: { layer: 'app-admin' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => ['shared.**'],
    })

    expect(result.misplacedKeys).toEqual([])
  })

  it('skips orphan keys (used by zero apps)', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['nonexistent.key.nowhere'], localeDir: { layer: 'app-admin' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    expect(result.misplacedKeys).toEqual([])
  })

  it('summary counts are correct', async () => {
    const keysByLayer = new Map([
      ['app-admin', { keys: ['shared.title'], localeDir: { layer: 'app-admin' } }],
      ['root', { keys: ['child.in.root'], localeDir: { layer: 'root' } }],
    ])

    const result = await findMisplacedKeysForConfig({
      keysByLayer,
      apps,
      resolveIgnorePatterns: () => undefined,
    })

    expect(result.summary.moveToRoot).toBe(1)
    expect(result.summary.moveToChild).toBe(1)
    expect(result.summary.total).toBe(2)
    expect(result.summary.byCurrentLayer['app-admin']).toBe(1)
    expect(result.summary.byCurrentLayer['root']).toBe(1)
  })
})
