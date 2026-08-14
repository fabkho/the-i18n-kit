import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { I18nKitPolicy } from './policy'

/** One locale, addressable by any of the three ref forms the kit accepts. */
export interface ArtifactLocale {
  code: string
  language: string
  file: string
  name?: string
}

/**
 * One Nuxt layer. `localeDir` is absent for layers that carry source code but
 * no translations — a real case (anny-ui's `app-admin/layers/dashboard-next`),
 * and the reason layers and locale directories cannot be derived from one
 * another: dropping such a layer silently removes it from source scanning,
 * which surfaces as false orphans rather than as an error.
 */
export interface ArtifactLayer {
  rootDir: string
  localeDir?: string
}

/**
 * What one Nuxt app publishes about itself.
 *
 * Layer *names* are deliberately absent. The CLI derives them relative to the
 * directory it was pointed at, and a module cannot know that directory — a
 * module inside `app-admin` would name its own layer `root` where the CLI
 * (run from the repo root) names it `app-admin`. Emitting raw directories and
 * letting the consumer name them keeps one naming implementation instead of
 * two that must agree.
 */
export interface I18nKitArtifact {
  version: 1
  generator: string
  appDir: string
  defaultLocale: string
  /**
   * Exactly as Nuxt resolved it — a string, an array or a per-locale map. The
   * CLI owns the normalisation, so that one implementation serves both the
   * artifact path and the fallback path instead of two that must agree.
   */
  fallbackLocale: string | string[] | Record<string, string | string[]> | null
  localeFileFormat: 'json'
  locales: ArtifactLocale[]
  /** Ordered as Nuxt resolved them: the app's own layer first, then what it extends. */
  layers: ArtifactLayer[]
  /**
   * Authoring policy declared in `nuxt.config.ts` under `i18nKit`. Absent when
   * none was declared, so the CLI can tell "nothing declared here" from
   * "declared as empty".
   */
  policy?: I18nKitPolicy
}

interface NuxtLayerLike {
  config: {
    rootDir: string
    i18n?: Record<string, unknown>
  }
}

export interface ArtifactInput {
  appDir: string
  i18n: Record<string, unknown>
  layers: NuxtLayerLike[]
  generator: string
  policy?: I18nKitPolicy
}

export async function buildArtifact(input: ArtifactInput): Promise<I18nKitArtifact> {
  return {
    version: 1,
    generator: input.generator,
    appDir: input.appDir,
    defaultLocale: (input.i18n.defaultLocale as string) ?? 'en',
    fallbackLocale: (input.i18n.fallbackLocale ?? null) as I18nKitArtifact['fallbackLocale'],
    localeFileFormat: 'json',
    locales: readLocales(input.i18n),
    layers: await readLayers(input.layers, input.i18n),
    ...(input.policy && Object.keys(input.policy).length > 0 ? { policy: input.policy } : {}),
  }
}

/**
 * Order is preserved, not sorted: it is precedence, and the CLI's own fallback
 * path reads the same array in the same order. Sorting would make the artifact
 * tidier and the two paths disagree.
 *
 * Deduplicated by code, though. A layered app sees each locale once per layer
 * that declares it — anny-ui's `app-admin` reports 60 entries for 30 locales,
 * every duplicate identical to the first — and a published table that repeats
 * itself invites consumers to count it.
 *
 * This mirrors the CLI's own locale reading, and the duplication is deliberate.
 * `fallbackLocale` avoids it by publishing what Nuxt resolved and normalising
 * once in the CLI; the locale table cannot, because the artifact is required to
 * carry `code`, `language`, `file` and `name` per entry (#305) so that any
 * consumer can resolve a ref without knowing @nuxtjs/i18n's legacy field names.
 * Sharing the code instead would mean depending on the CLI from a Nuxt module,
 * which couples their release cycles for eight lines.
 */
function readLocales(i18n: Record<string, unknown>): ArtifactLocale[] {
  const raw = (i18n.locales ?? []) as Array<Record<string, unknown>>
  const seen = new Set<string>()

  return raw
    .filter(l => typeof l === 'object' && l !== null)
    .map(l => ({
      code: String(l.code ?? ''),
      language: String(l.language ?? l.iso ?? ''),
      file: String(l.file ?? ''),
      ...(l.name ? { name: String(l.name) } : {}),
    }))
    .filter((l) => {
      if (!l.code || !l.file || seen.has(l.code)) return false
      seen.add(l.code)
      return true
    })
}

/**
 * A layer's locale directory is reported only when it exists and holds JSON,
 * matching what the CLI's own discovery accepts. An empty or absent directory
 * leaves the layer in the list without one, rather than dropping the layer.
 */
async function readLayers(
  layers: NuxtLayerLike[],
  appI18n: Record<string, unknown>,
): Promise<ArtifactLayer[]> {
  const result: ArtifactLayer[] = []

  for (const layer of layers) {
    const rootDir = layer.config.rootDir
    const i18n = layer.config.i18n ?? appI18n
    const langDir = (i18n.langDir as string) ?? 'locales'
    const restructureDir = (i18n.restructureDir as string) ?? 'i18n'
    const localeDir = resolve(rootDir, restructureDir, langDir)

    result.push({ rootDir, ...(await holdsLocales(localeDir) ? { localeDir } : {}) })
  }

  return result
}

async function holdsLocales(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  try {
    return (await readdir(dir)).some(f => f.endsWith('.json'))
  }
  catch {
    return false
  }
}
