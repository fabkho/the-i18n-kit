/**
 * Tests for ancestor-based layer dedup (issue #70).
 *
 * When two layers claim the same locale directory path, the layer whose
 * `layerRootDir` is an ancestor of (or equal to) the locale dir path is the
 * true owner. The other layer gets `aliasOf` pointing to the owner.
 *
 * The tests exercise `resolveLayerOwnership` — the pure helper extracted
 * from the dedup logic in `src/adapters/nuxt/index.ts`.
 */

import { describe, it, expect } from 'vitest'
import { resolveLayerOwnership } from '../../src/adapters/nuxt/layer-dedup.js'

// Helper: build absolute paths without platform issues
const base = '/projects'
const appShop = `${base}/app-shop`
const appOutlook = `${base}/app-outlook`
const sharedLocaleDir = `${appShop}/i18n/locales`

describe('resolveLayerOwnership — ancestor is the true owner', () => {
  it('existing layer owns when its root is an ancestor of the locale dir', () => {
    // app-shop was discovered first and claims app-shop/i18n/locales
    // app-outlook is discovered next with same realpath (via alias)
    const result = resolveLayerOwnership(
      { layer: 'app-shop', layerRootDir: appShop },
      { layer: 'app-outlook', layerRootDir: appOutlook },
      sharedLocaleDir,
    )
    expect(result.owner).toBe('app-shop')
    expect(result.alias).toBe('app-outlook')
  })

  it('incoming layer wins when its root is an ancestor and existing is not', () => {
    // app-outlook was (wrongly) processed first, claims app-shop/i18n/locales
    // app-shop arrives later — it should take over as the true owner
    const result = resolveLayerOwnership(
      { layer: 'app-outlook', layerRootDir: appOutlook },
      { layer: 'app-shop', layerRootDir: appShop },
      sharedLocaleDir,
    )
    expect(result.owner).toBe('app-shop')
    expect(result.alias).toBe('app-outlook')
  })

  it('discovery order does not matter: shop-first gives same result as outlook-first', () => {
    const shopFirst = resolveLayerOwnership(
      { layer: 'app-shop', layerRootDir: appShop },
      { layer: 'app-outlook', layerRootDir: appOutlook },
      sharedLocaleDir,
    )
    const outlookFirst = resolveLayerOwnership(
      { layer: 'app-outlook', layerRootDir: appOutlook },
      { layer: 'app-shop', layerRootDir: appShop },
      sharedLocaleDir,
    )
    expect(shopFirst.owner).toBe(outlookFirst.owner)
    expect(shopFirst.alias).toBe(outlookFirst.alias)
  })

  it('alias layer gets aliasOf set to the owner layer name', () => {
    const result = resolveLayerOwnership(
      { layer: 'app-outlook', layerRootDir: appOutlook },
      { layer: 'app-shop', layerRootDir: appShop },
      sharedLocaleDir,
    )
    // incoming (app-shop) is the true owner; existing (app-outlook) becomes alias
    expect(result.owner).toBe('app-shop')
    expect(result.alias).toBe('app-outlook')
  })
})

describe('resolveLayerOwnership — nested layers: more specific wins', () => {
  const outerDir = `${base}/monorepo`
  const innerDir = `${outerDir}/packages/shop`
  const nestedLocaleDir = `${innerDir}/i18n/locales`

  it('inner (more specific) ancestor wins over outer ancestor', () => {
    const result = resolveLayerOwnership(
      { layer: 'monorepo', layerRootDir: outerDir },
      { layer: 'shop', layerRootDir: innerDir },
      nestedLocaleDir,
    )
    expect(result.owner).toBe('shop')
    expect(result.alias).toBe('monorepo')
  })

  it('more specific wins regardless of discovery order', () => {
    const shopFirst = resolveLayerOwnership(
      { layer: 'shop', layerRootDir: innerDir },
      { layer: 'monorepo', layerRootDir: outerDir },
      nestedLocaleDir,
    )
    expect(shopFirst.owner).toBe('shop')
    expect(shopFirst.alias).toBe('monorepo')
  })
})

describe('resolveLayerOwnership — fallback when neither is an ancestor', () => {
  it('returns existing as owner when neither root is an ancestor (first-wins fallback)', () => {
    const dirA = `${base}/app-a`
    const dirB = `${base}/app-b`
    const someSharedDir = `${base}/shared/i18n/locales`

    const result = resolveLayerOwnership(
      { layer: 'app-a', layerRootDir: dirA },
      { layer: 'app-b', layerRootDir: dirB },
      someSharedDir,
    )
    // Neither is an ancestor → first-wins (existing keeps ownership)
    expect(result.owner).toBe('app-a')
    expect(result.alias).toBe('app-b')
  })
})

describe('resolveLayerOwnership — when both are ancestors (same root), existing wins', () => {
  it('exact-same layerRootDir: existing layer keeps ownership', () => {
    const result = resolveLayerOwnership(
      { layer: 'root', layerRootDir: appShop },
      { layer: 'root-copy', layerRootDir: appShop },
      sharedLocaleDir,
    )
    expect(result.owner).toBe('root')
    expect(result.alias).toBe('root-copy')
  })
})
