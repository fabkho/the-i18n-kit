import { describe, it, expect } from 'vitest'
import { buildLayerGraph, serializeLayerGraph } from '../../src/config/layer-graph.js'
import type { I18nConfig } from '../../src/config/types.js'
import {
  createMultiAppConfig,
  createNoAppsConfig,
  createPlaygroundConfig,
} from '../fixtures/config.js'

describe('buildLayerGraph — canonical layers', () => {
  const graph = buildLayerGraph(createMultiAppConfig())

  it('canonicalLayers excludes alias entries', () => {
    const names = graph.canonicalLayers.map(d => d.layer)
    expect(names).toEqual(['root', 'app-admin', 'app-shop'])
    expect(graph.canonicalLayers.every(d => !d.aliasOf)).toBe(true)
  })
})

describe('buildLayerGraph — ownerOf alias resolution', () => {
  const graph = buildLayerGraph(createMultiAppConfig())

  it('is identity for canonical layer names', () => {
    expect(graph.ownerOf('root')).toBe('root')
    expect(graph.ownerOf('app-admin')).toBe('app-admin')
    expect(graph.ownerOf('app-shop')).toBe('app-shop')
  })

  it('resolves an alias to its owning layer', () => {
    expect(graph.ownerOf('app-outlook')).toBe('app-shop')
  })

  it('is identity for names unknown to localeDirs', () => {
    expect(graph.ownerOf('no-such-layer')).toBe('no-such-layer')
  })

  it('follows chained aliasOf links', () => {
    const config = createMultiAppConfig()
    // app-legacy -> app-outlook -> app-shop (an alias pointing at a layer
    // that was itself demoted to an alias — claimLocaleDir can produce this)
    config.localeDirs.push({
      path: config.localeDirs[3].path,
      layer: 'app-legacy',
      layerRootDir: config.localeDirs[3].layerRootDir,
      aliasOf: 'app-outlook',
    })
    expect(buildLayerGraph(config).ownerOf('app-legacy')).toBe('app-shop')
  })

  it('terminates on a (malformed) alias cycle', () => {
    const config = createMultiAppConfig()
    config.localeDirs.push(
      { path: '/tmp/a', layer: 'cycle-a', layerRootDir: '/tmp/a', aliasOf: 'cycle-b' },
      { path: '/tmp/b', layer: 'cycle-b', layerRootDir: '/tmp/b', aliasOf: 'cycle-a' },
    )
    expect(['cycle-a', 'cycle-b']).toContain(buildLayerGraph(config).ownerOf('cycle-a'))
  })
})

describe('buildLayerGraph — appsUsingLayer', () => {
  const graph = buildLayerGraph(createMultiAppConfig())

  it('returns all apps for the shared root layer', () => {
    expect(graph.appsUsingLayer('root').sort()).toEqual([
      'app-admin',
      'app-outlook',
      'app-shop',
    ])
  })

  it('returns only the owning app for a private layer', () => {
    expect(graph.appsUsingLayer('app-admin')).toEqual(['app-admin'])
  })

  it('resolves alias names in app layer lists to owners', () => {
    // app-outlook consumes 'app-outlook' (alias of app-shop) — the edge
    // must land on the canonical layer.
    expect(graph.appsUsingLayer('app-shop').sort()).toEqual(['app-outlook', 'app-shop'])
  })

  it('resolves an alias query to the owner\'s consumers', () => {
    expect(graph.appsUsingLayer('app-outlook').sort()).toEqual(['app-outlook', 'app-shop'])
  })

  it('returns [] for a layer no app consumes', () => {
    expect(graph.appsUsingLayer('no-such-layer')).toEqual([])
  })
})

describe('buildLayerGraph — sharedLayers', () => {
  const graph = buildLayerGraph(createMultiAppConfig())

  it('identifies the root layer from consumption edges alone', () => {
    const names = graph.sharedLayers.map(d => d.layer).sort()
    expect(names).toContain('root')
    // app-shop is shared too: consumed by app-shop and (via alias) app-outlook
    expect(names).toEqual(['app-shop', 'root'])
  })

  it('excludes app-private layers', () => {
    expect(graph.sharedLayers.map(d => d.layer)).not.toContain('app-admin')
  })
})

describe('buildLayerGraph — layersOfApp', () => {
  const graph = buildLayerGraph(createMultiAppConfig())

  it('returns canonical layers the app consumes', () => {
    expect(graph.layersOfApp('app-admin').map(d => d.layer).sort()).toEqual([
      'app-admin',
      'root',
    ])
  })

  it('resolves alias entries in the app layer list', () => {
    expect(graph.layersOfApp('app-outlook').map(d => d.layer).sort()).toEqual([
      'app-shop',
      'root',
    ])
    expect(graph.layersOfApp('app-outlook').every(d => !d.aliasOf)).toBe(true)
  })

  it('returns [] for an unknown app', () => {
    expect(graph.layersOfApp('no-such-app')).toEqual([])
  })

  it('omits consumed layers without locale dirs but keeps their consumption edges', () => {
    const config = createMultiAppConfig()
    // A Nuxt layer without an i18n/locales dir appears in app.layers but
    // never in localeDirs.
    config.apps[0].layers.push('base-no-i18n')
    const withBase = buildLayerGraph(config)
    expect(withBase.layersOfApp('app-admin').map(d => d.layer).sort()).toEqual([
      'app-admin',
      'root',
    ])
    expect(withBase.appsUsingLayer('base-no-i18n')).toEqual(['app-admin'])
  })
})

describe('buildLayerGraph — degenerate configs', () => {
  it('no-apps config: every canonical layer is trivially shared', () => {
    const graph = buildLayerGraph(createNoAppsConfig())
    expect(graph.canonicalLayers.map(d => d.layer)).toEqual(['default'])
    expect(graph.sharedLayers).toEqual(graph.canonicalLayers)
  })

  it('no-apps config: consumption queries return empty results', () => {
    const graph = buildLayerGraph(createNoAppsConfig())
    expect(graph.appsUsingLayer('default')).toEqual([])
    expect(graph.layersOfApp('default')).toEqual([])
  })

  it('tolerates a config where apps is absent entirely', () => {
    const config = createNoAppsConfig() as Partial<I18nConfig>
    delete config.apps
    const graph = buildLayerGraph(config as I18nConfig)
    expect(graph.sharedLayers.map(d => d.layer)).toEqual(['default'])
    expect(graph.appsUsingLayer('default')).toEqual([])
  })

  it('single-app config: no layer is shared, the app consumes its layers', () => {
    const graph = buildLayerGraph(createPlaygroundConfig())
    expect(graph.canonicalLayers.map(d => d.layer)).toEqual(['root'])
    expect(graph.sharedLayers).toEqual([])
    expect(graph.appsUsingLayer('root')).toEqual(['root'])
    expect(graph.layersOfApp('root').map(d => d.layer)).toEqual(['root'])
  })
})

/**
 * The graph as JSON, which is the only form the MCP surface can carry (#342).
 * The degenerate cases matter more here than anywhere: a consumer reading this
 * to place a key has nothing else to fall back on.
 */
describe('serializeLayerGraph', () => {
  it('names the shared layers a key can be placed in, and who consumes each', () => {
    const graph = serializeLayerGraph(createMultiAppConfig())

    expect(graph.canonical).toEqual(['root', 'app-admin', 'app-shop'])
    // root because all three apps consume it. app-shop because app-outlook is
    // an alias of it, so two apps read the same dir — a key used by both
    // belongs there rather than in root, which no name-matching would tell you.
    expect(graph.shared).toEqual(['root', 'app-shop'])
    expect(graph.consumers.root).toEqual(['app-admin', 'app-shop', 'app-outlook'])
    expect(graph.consumers['app-admin']).toEqual(['app-admin'])
  })

  it('resolves an alias to the layer whose dir actually holds the keys', () => {
    const graph = serializeLayerGraph(createMultiAppConfig())

    expect(graph.aliases).toEqual({ 'app-outlook': 'app-shop' })
    // The alias is not a placement target: it has no dir of its own.
    expect(graph.canonical).not.toContain('app-outlook')
    // Its consumption still counts, through the layer that owns the dir.
    expect(graph.consumers['app-shop']).toEqual(['app-shop', 'app-outlook'])
  })

  it('reports every layer as shared when no app info exists, rather than none', () => {
    // Absent app info is not "nothing is shared" — ownership is unknowable, so
    // every layer's keys must be treated as globally visible. Flattening that
    // to an empty array would invite a consumer to narrow scope wrongly.
    const graph = serializeLayerGraph(createNoAppsConfig())

    expect(graph.shared).toEqual(graph.canonical)
    expect(graph.consumers).toEqual({ default: [] })
  })

  it('keeps a layer no app consumes as an empty list, not a missing key', () => {
    const config = createMultiAppConfig()
    config.apps = config.apps!.filter(app => app.name !== 'app-admin')

    const graph = serializeLayerGraph(config)

    expect(graph.canonical).toContain('app-admin')
    expect(graph.consumers['app-admin']).toEqual([])
    expect(graph.shared).not.toContain('app-admin')
  })

  it('reports nothing as shared for a single-app project', () => {
    const graph = serializeLayerGraph(createPlaygroundConfig())

    expect(graph.shared).toEqual([])
    expect(graph.consumers.root).toEqual(['root'])
  })
})
