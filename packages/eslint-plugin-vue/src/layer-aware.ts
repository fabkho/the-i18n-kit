import { relative, isAbsolute, sep } from 'node:path'
import type { Linter } from 'eslint'

/**
 * The layer-aware preset (#422): per-app flat-config blocks that point
 * @intlify/eslint-plugin-vue-i18n's `no-missing-keys` at exactly the
 * catalogues each app consumes. Derived from the kit's detection at lint
 * startup — the hand-written blocks this replaces go stale the day a layer
 * is added; these cannot.
 *
 * Validated shape: the anny-ui spike (hand-written equivalent, 2026-08-24) —
 * root keys pass everywhere, an app's keys error from other apps, 1,314
 * files in ~7s.
 */

export interface LayerAwareOptions {
  /** Where detection runs. Default: process.cwd() — run ESLint from the repo root. */
  projectDir?: string
  /**
   * Glob for the reference-locale file inside each locale dir. Default:
   * `<defaultLocale>*.json`. Existence is checked against the reference
   * locale only — a key defined solely elsewhere is itself a defect that
   * `missing` reports.
   */
  referenceLocaleFile?: string
  /** Injected detection result — tests use this; real runs detect. */
  config?: DetectedConfig
}

/** The slice of the kit's detection the factory reads. */
export interface DetectedConfig {
  defaultLocale?: string
  localeDirs?: Array<{ layer: string, path: string, layerRootDir?: string }>
}

export async function layerAware(options: LayerAwareOptions = {}): Promise<Linter.Config[]> {
  const projectDir = options.projectDir ?? process.cwd()
  const config = options.config ?? await detect(projectDir)
  const intlify = await loadIntlify()

  const refFile = options.referenceLocaleFile ?? `${config.defaultLocale ?? 'en'}*.json`
  const dirs = config.localeDirs ?? []
  // Globs are always /-separated; on Windows, relative() is not.
  const rel = (p: string) => (isAbsolute(p) ? relative(projectDir, p) : p).split(sep).join('/')

  const rootCatalogs = dirs.filter(d => d.layer === 'root').map(d => `${rel(d.path)}/${refFile}`)
  const appDirs = dirs.filter(d => d.layer !== 'root' && d.layerRootDir && rel(d.layerRootDir) !== '')

  const settingsFor = (localeDir: string[]): Linter.Config['settings'] => ({
    'vue-i18n': { localeDir, messageSyntaxVersion: '^9.0.0' },
  })

  return [
    {
      name: '@the-i18n-kit/layer-aware/rules',
      files: ['**/*.vue', '**/*.ts', '**/*.js', '**/*.mjs', '**/*.tsx', '**/*.jsx'],
      plugins: { '@intlify/vue-i18n': intlify },
      rules: { '@intlify/vue-i18n/no-missing-keys': 'error' },
    },
    // Root-owned code sees the root catalogue; the app blocks below override
    // settings for their subtrees (flat config: the later matching entry wins).
    {
      name: '@the-i18n-kit/layer-aware/root',
      files: ['**/*.vue', '**/*.ts', '**/*.js', '**/*.mjs', '**/*.tsx', '**/*.jsx'],
      settings: settingsFor(rootCatalogs),
    },
    ...appDirs.map(d => ({
      name: `@the-i18n-kit/layer-aware/${d.layer}`,
      files: [`${rel(d.layerRootDir!)}/**`],
      settings: settingsFor([...rootCatalogs, `${rel(d.path)}/${refFile}`]),
    })),
  ]
}

async function detect(projectDir: string): Promise<DetectedConfig> {
  const cli = await import('@the-i18n-kit/cli').catch(() => {
    throw new Error('@the-i18n-kit/eslint-plugin: layerAware() needs @the-i18n-kit/cli installed to detect the project. Install it: npm i -D @the-i18n-kit/cli')
  })
  return await (cli as { detectI18nConfig: (dir: string) => Promise<DetectedConfig> }).detectI18nConfig(projectDir)
}

async function loadIntlify(): Promise<NonNullable<Linter.Config['plugins']>[string]> {
  const mod = await import('@intlify/eslint-plugin-vue-i18n').catch(() => {
    throw new Error('@the-i18n-kit/eslint-plugin: layerAware() wraps @intlify/eslint-plugin-vue-i18n. Install it: npm i -D @intlify/eslint-plugin-vue-i18n')
  })
  const plugin = (mod as { default?: unknown }).default ?? mod
  return plugin as NonNullable<Linter.Config['plugins']>[string]
}
