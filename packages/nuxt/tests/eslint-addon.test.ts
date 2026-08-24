import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

import { eslintAddonDecision, i18nKitEslintAddon } from '../src/eslint-addon'

/**
 * The zero-config ESLint path (#424). The addon contributes to @nuxt/eslint's
 * *generated* config, so its whole job is knowing when that config is the
 * right surface: inject at the project root, defer inside a workspace, skip
 * silently when the peers are not installed.
 */

const base = join(tmpdir(), `i18n-eslint-addon-${process.pid}`)
const withPeers = join(base, 'standalone')
const workspace = join(base, 'workspace')
const subApp = join(workspace, 'app-admin')
const bare = join(base, 'bare')

/** Symlink the real packages so createRequire resolution is the real thing. */
async function linkPeers(dir: string) {
  const require = createRequire(import.meta.url)
  await mkdir(join(dir, 'node_modules/@the-i18n-kit'), { recursive: true })
  await mkdir(join(dir, 'node_modules/@intlify'), { recursive: true })
  await symlink(
    join(import.meta.dirname, '..', '..', 'eslint-plugin-vue'),
    join(dir, 'node_modules/@the-i18n-kit/eslint-plugin-vue'),
  )
  await symlink(
    join(require.resolve('@intlify/eslint-plugin-vue-i18n/package.json'), '..'),
    join(dir, 'node_modules/@intlify/eslint-plugin-vue-i18n'),
  )
}

beforeAll(async () => {
  await rm(base, { recursive: true, force: true })
  for (const dir of [withPeers, subApp, bare]) await mkdir(dir, { recursive: true })
  await linkPeers(withPeers)
  await linkPeers(subApp)
  // The workspace root owns the kit config; the sub-app must defer to it.
  await writeFile(join(workspace, 'i18n-kit.config.ts'), 'export default {}')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('deciding whether the generated config is the right surface', () => {
  it('injects at a standalone project root', () => {
    expect(eslintAddonDecision(withPeers)).toBe('inject')
  })

  it('defers inside a workspace whose kit config lives above', () => {
    expect(eslintAddonDecision(subApp)).toBe('defer')
  })

  it('skips silently when the peers are not installed', () => {
    expect(eslintAddonDecision(bare)).toBe('skip')
  })
})

describe('what the addon contributes', () => {
  it('emits the recommended preset and a layerAware call rooted at the app', () => {
    const addon = i18nKitEslintAddon(withPeers, () => {})
    const result = addon.getConfigs()!

    expect(result.imports?.map(i => i.from)).toEqual([
      '@the-i18n-kit/eslint-plugin-vue',
      '@the-i18n-kit/eslint-plugin-vue',
    ])
    expect(result.configs?.[0]).toContain('configs.recommended')
    expect(result.configs?.[1]).toContain('LayerAware')
    expect(result.configs?.[1]).toContain(JSON.stringify(withPeers))
  })

  it('contributes nothing on defer, and says where the lint belongs instead', () => {
    const hints: string[] = []
    const addon = i18nKitEslintAddon(subApp, m => hints.push(m))

    expect(addon.getConfigs()).toBeUndefined()
    expect(hints.join(' ')).toContain('workspace root')
  })

  it('contributes nothing, silently, without the peers', () => {
    const hints: string[] = []
    const addon = i18nKitEslintAddon(bare, m => hints.push(m))

    expect(addon.getConfigs()).toBeUndefined()
    expect(hints).toEqual([])
  })
})
