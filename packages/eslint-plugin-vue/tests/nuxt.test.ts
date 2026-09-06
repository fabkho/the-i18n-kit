import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { eslintAddonDecision, i18nKitEslintAddon } from '../src/nuxt.js'

/**
 * The addon contributes to @nuxt/eslint's *generated* config, so its whole job
 * is knowing when that config is the right surface: inject at the project
 * root, defer inside a workspace whose root config owns linting.
 *
 * Installation is no longer part of that judgement. Reaching the addon means
 * importing it from this package, so the package is installed by construction
 * — the check the Nuxt module needed (a hand-rolled node_modules walk) has no
 * question left to answer.
 */

const base = join(tmpdir(), `i18n-eslint-addon-${process.pid}`)
const standalone = join(base, 'standalone')
const workspace = join(base, 'workspace')
const subApp = join(workspace, 'app-admin')

beforeAll(async () => {
  await rm(base, { recursive: true, force: true })
  for (const dir of [standalone, subApp]) await mkdir(dir, { recursive: true })
  // The workspace root owns the kit config; the sub-app must defer to it.
  await writeFile(join(workspace, 'i18n-kit.config.ts'), 'export default {}')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('deciding whether the generated config is the right surface', () => {
  it('injects at a standalone project root', () => {
    expect(eslintAddonDecision(standalone)).toBe('inject')
  })

  it('defers inside a workspace whose kit config lives above', () => {
    expect(eslintAddonDecision(subApp)).toBe('defer')
  })
})

describe('what the addon contributes', () => {
  it('emits the recommended preset and a layerAware call rooted at the app', () => {
    const addon = i18nKitEslintAddon({ rootDir: standalone, onDefer: () => {} })
    const result = addon.getConfigs()!

    expect(result.imports?.map(i => i.from)).toEqual([
      '@the-i18n-kit/eslint-plugin-vue',
      '@the-i18n-kit/eslint-plugin-vue',
    ])
    expect(result.configs?.[0]).toContain('configs.recommended')
    expect(result.configs?.[1]).toContain('LayerAware')
    expect(result.configs?.[1]).toContain(JSON.stringify(standalone))
  })

  it('contributes nothing on defer, and says where the lint belongs instead', () => {
    const hints: string[] = []
    const addon = i18nKitEslintAddon({ rootDir: subApp, onDefer: m => hints.push(m) })

    expect(addon.getConfigs()).toBeUndefined()
    expect(hints.join(' ')).toContain('workspace root')
  })

  it('takes no arguments at all — the app is where Nuxt reads its config from', () => {
    // `getConfigs` is not called here: its answer depends on whatever lies
    // above the working directory, which is not this test's business.
    expect(i18nKitEslintAddon().name).toBe('the-i18n-kit')
  })
})
