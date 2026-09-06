import type { I18nConfig, LocaleDir } from './types'

/**
 * Queryable view over the layer topology a resolved {@link I18nConfig}
 * already carries: which locale dirs are canonical (alias-free), which
 * layer owns an aliased dir, and which apps consume which layers.
 *
 * This is a pure derivation — no filesystem access, no config-shape
 * changes. Cross-layer tooling (duplicate detection, scope-aware orphan
 * scanning) builds on these queries instead of name-matching heuristics.
 *
 * ## Degenerate-case semantics
 *
 * These are load-bearing for consumers (scope-aware scanning must never
 * wrongly narrow its scan scope):
 *
 * - **No app info** (`config.apps` empty or absent, e.g. hand-built
 *   configs): consumption edges are unknowable. `appsUsingLayer` and
 *   `layersOfApp` return `[]`, and `sharedLayers` conservatively contains
 *   *every* canonical layer — with no ownership information, every
 *   layer's keys must be treated as globally visible.
 * - **Single-app config** (generic/Laravel/React adapters, or a Nuxt
 *   project with one app): the strict definition applies, so
 *   `sharedLayers` is empty (no layer is consumed by more than one app)
 *   and `appsUsingLayer` returns that one app for the layers it consumes.
 *   Per-layer scope then equals the whole project, which is correct.
 * - **Canonical layer consumed by no app** (in a multi-app config):
 *   `appsUsingLayer` returns `[]` and the layer is not in `sharedLayers`.
 *   Callers should treat such layers conservatively (global scope).
 */
export interface LayerGraph {
  /**
   * Alias-free locale dirs, in `config.localeDirs` order. Aliased entries
   * (e.g. `app-outlook` pointing at `app-shop`'s dir) are excluded.
   */
  canonicalLayers: LocaleDir[]
  /**
   * Resolve a layer name to the canonical layer that owns its locale dir.
   * Follows chained `aliasOf` links (an alias may point at a layer that
   * was itself demoted to an alias). Identity for canonical names and for
   * names unknown to `localeDirs` (e.g. layers without locale dirs).
   */
  ownerOf: (layer: string) => string
  /**
   * Names of apps whose consumed layers include the given layer. The
   * queried name and each app's layer list are alias-resolved via
   * {@link ownerOf} first, so querying an alias name yields the owner's
   * consumers. Returns `[]` when no app info exists.
   */
  appsUsingLayer: (layer: string) => string[]
  /**
   * Canonical layers consumed by more than one app — e.g. a shared root
   * layer in a multi-app monorepo, identified purely from consumption
   * edges (no name matching). When no app info exists, contains every
   * canonical layer (see degenerate-case semantics above).
   */
  sharedLayers: LocaleDir[]
  /**
   * Canonical layers the given app consumes (alias entries in the app's
   * layer list resolve to their owners; layers without locale dirs are
   * omitted). Returns `[]` for unknown apps or when no app info exists.
   */
  layersOfApp: (app: string) => LocaleDir[]
}

/**
 * Build the alias resolver: follows chained `aliasOf` links to the owning
 * canonical layer. Identity for canonical and unknown names; guarded
 * against (malformed) alias cycles.
 */
function buildOwnerResolver(localeDirs: LocaleDir[]): (layer: string) => string {
  // alias name -> immediate target (owner or another alias)
  const aliasTargets = new Map<string, string>()
  for (const dir of localeDirs) {
    if (dir.aliasOf && dir.aliasOf !== dir.layer) {
      aliasTargets.set(dir.layer, dir.aliasOf)
    }
  }

  return (layer: string): string => {
    let current = layer
    const seen = new Set<string>()
    while (aliasTargets.has(current) && !seen.has(current)) {
      seen.add(current)
      current = aliasTargets.get(current)!
    }
    return current
  }
}

interface ConsumptionEdges {
  /** canonical layer name -> names of apps consuming it */
  consumers: Map<string, Set<string>>
  /** app name -> canonical layer names it consumes (locale-dir-backed only) */
  consumed: Map<string, Set<string>>
}

/**
 * Build app → layer consumption edges, alias-resolving every layer name in
 * each app's layer list. `consumers` keeps edges for layers without locale
 * dirs too (so `appsUsingLayer` can answer for them); `consumed` is
 * restricted to canonical, locale-dir-backed layers.
 */
function buildConsumptionEdges(
  apps: I18nConfig['apps'],
  ownerOf: (layer: string) => string,
  canonicalNames: Set<string>,
): ConsumptionEdges {
  const consumers = new Map<string, Set<string>>()
  const consumed = new Map<string, Set<string>>()

  for (const app of apps) {
    const consumedByApp = consumed.get(app.name) ?? new Set<string>()
    consumed.set(app.name, consumedByApp)
    for (const layerName of app.layers) {
      const owner = ownerOf(layerName)
      const layerConsumers = consumers.get(owner) ?? new Set<string>()
      consumers.set(owner, layerConsumers)
      layerConsumers.add(app.name)
      if (canonicalNames.has(owner)) {
        consumedByApp.add(owner)
      }
    }
  }

  return { consumers, consumed }
}

/**
 * Build a {@link LayerGraph} from a resolved config's `localeDirs`
 * (with their `aliasOf` markers) and `apps` (app → consumed-layers edges).
 */
export function buildLayerGraph(config: I18nConfig): LayerGraph {
  const localeDirs = config.localeDirs ?? []
  const canonicalLayers = localeDirs.filter(d => !d.aliasOf)
  const canonicalNames = new Set(canonicalLayers.map(d => d.layer))
  const ownerOf = buildOwnerResolver(localeDirs)

  const apps = config.apps ?? []
  const { consumers, consumed } = buildConsumptionEdges(apps, ownerOf, canonicalNames)

  const sharedLayers = apps.length > 0
    ? canonicalLayers.filter(d => (consumers.get(d.layer)?.size ?? 0) > 1)
    : [...canonicalLayers]

  const appsUsingLayer = (layer: string): string[] =>
    [...(consumers.get(ownerOf(layer)) ?? [])]

  const layersOfApp = (app: string): LocaleDir[] => {
    const names = consumed.get(app)
    if (!names || names.size === 0) return []
    return canonicalLayers.filter(d => names.has(d.layer))
  }

  return { canonicalLayers, ownerOf, appsUsingLayer, sharedLayers, layersOfApp }
}

/**
 * The graph as plain data, for surfaces that can only carry JSON.
 *
 * {@link LayerGraph} is function-valued, so it cannot be serialised directly.
 * This answers the question an agent actually has — *which layer does this key
 * belong in* — which the flat layer list `discover` returned could not: a key
 * used by more than one app belongs in a layer those apps share, and `shared`
 * names those layers outright (#342).
 *
 * The degenerate cases documented on {@link LayerGraph} survive the flattening,
 * because they are what keeps a consumer from wrongly narrowing scope:
 * a config with no app info reports *every* canonical layer as shared, and a
 * layer no app consumes appears in `consumers` with an empty array rather than
 * being left out. Absent and "none" must not look alike here.
 */
export interface SerializedLayerGraph {
  /** Alias-free layer names, in `config.localeDirs` order. */
  canonical: string[]
  /** Canonical layers consumed by more than one app — where shared keys belong. */
  shared: string[]
  /** Alias layer name → the canonical layer whose locale dir it points at. */
  aliases: Record<string, string>
  /** Canonical layer name → the apps consuming it. Every canonical layer is a key. */
  consumers: Record<string, string[]>
}

/** Flatten {@link buildLayerGraph}'s view of `config` into plain JSON. */
export function serializeLayerGraph(config: I18nConfig): SerializedLayerGraph {
  const graph = buildLayerGraph(config)
  const canonical = graph.canonicalLayers.map(dir => dir.layer)

  return {
    canonical,
    shared: graph.sharedLayers.map(dir => dir.layer),
    aliases: Object.fromEntries(
      (config.localeDirs ?? [])
        .filter(dir => dir.aliasOf)
        // ownerOf, not aliasOf: an alias may point at a layer that was itself
        // demoted to one, and a reader wants the dir that actually holds the keys.
        .map(dir => [dir.layer, graph.ownerOf(dir.layer)]),
    ),
    consumers: Object.fromEntries(
      canonical.map(layer => [layer, graph.appsUsingLayer(layer)]),
    ),
  }
}
