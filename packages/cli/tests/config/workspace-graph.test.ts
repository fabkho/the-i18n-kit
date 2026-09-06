/**
 * Consumer-graph inference from the package manager workspace: which
 * workspace packages own which layers, which of them are apps, and how a
 * declared `apps` list or `consumerGraph: 'off'` overrides the inference.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { inferWorkspaceApps, parsePnpmWorkspacePackages } from '../../src/config/workspace-graph.js'
import { detectI18nConfig, clearConfigCache } from '../../src/config/detector.js'
import type { LocaleDir } from '../../src/config/types.js'

// ─── Fixture ────────────────────────────────────────────────────

const PACKAGES = [
  { dir: 'apps/shop', name: 'shop', layer: 'shop', deps: ['ui', 'shared-i18n'] },
  { dir: 'apps/admin', name: 'admin', layer: 'admin', deps: ['shared-i18n'] },
  { dir: 'packages/ui', name: 'ui', layer: 'ui', deps: [] },
  { dir: 'packages/shared-i18n', name: 'shared-i18n', layer: 'shared-i18n', deps: [] },
]

const created: string[] = []

afterAll(async () => {
  await Promise.all(created.map(dir => rm(dir, { recursive: true, force: true })))
})

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf-8')
}

/**
 * A four-package monorepo: two apps, a UI kit consumed only by the shop, and
 * a locale package consumed by both.
 */
async function createFixture(opts: {
  workspace: 'pnpm' | 'npm' | 'npm-object' | 'none'
  projectConfig?: Record<string, unknown>
} = { workspace: 'pnpm' }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'i18n-workspace-graph-'))
  created.push(root)

  const globs = ['apps/*', 'packages/*']
  const rootManifest: Record<string, unknown> = { name: 'monorepo-root', private: true }
  if (opts.workspace === 'pnpm') {
    await writeFile(join(root, 'pnpm-workspace.yaml'), `packages:\n  - 'apps/*'\n  - 'packages/*'\n`, 'utf-8')
  }
  if (opts.workspace === 'npm') rootManifest.workspaces = globs
  if (opts.workspace === 'npm-object') rootManifest.workspaces = { packages: globs }
  await writeJson(join(root, 'package.json'), rootManifest)

  for (const pkg of PACKAGES) {
    await writeJson(join(root, pkg.dir, 'package.json'), {
      name: pkg.name,
      dependencies: Object.fromEntries(pkg.deps.map(dep => [dep, 'workspace:*'])),
    })
    await writeJson(join(root, pkg.dir, 'locales/en.json'), { [pkg.layer]: { used: 'x' } })
  }

  if (opts.projectConfig) {
    await writeJson(join(root, '.i18n-mcp.json'), {
      defaultLocale: 'en',
      localeDirs: PACKAGES.map(pkg => ({ path: `${pkg.dir}/locales`, layer: pkg.layer })),
      ...opts.projectConfig,
    })
  }

  return root
}

/** The locale dirs an adapter would hand to the inference for that fixture. */
function fixtureLayers(root: string): LocaleDir[] {
  return PACKAGES.map(pkg => ({
    path: join(root, pkg.dir, 'locales'),
    layer: pkg.layer,
    layerRootDir: root,
  }))
}

// ─── Inference ──────────────────────────────────────────────────

describe('inferWorkspaceApps — pnpm workspace', () => {
  it('makes an app of each package nothing else depends on, with its dependencies\' layers', async () => {
    const root = await createFixture({ workspace: 'pnpm' })

    expect(await inferWorkspaceApps(root, fixtureLayers(root))).toEqual([
      {
        name: 'admin',
        rootDir: join(root, 'apps/admin'),
        layers: ['admin', 'shared-i18n'],
        source: 'workspace',
      },
      {
        name: 'shop',
        rootDir: join(root, 'apps/shop'),
        layers: ['shop', 'ui', 'shared-i18n'],
        source: 'workspace',
      },
    ])
  })

  it('does not give a layer to an app that does not depend on its package', async () => {
    const root = await createFixture({ workspace: 'pnpm' })

    const apps = await inferWorkspaceApps(root, fixtureLayers(root))
    expect(apps?.find(app => app.name === 'admin')?.layers).not.toContain('ui')
  })

  it('attaches a layer outside every workspace package to every app', async () => {
    const root = await createFixture({ workspace: 'pnpm' })
    const layers = [
      ...fixtureLayers(root),
      { path: join(root, 'locales'), layer: 'root', layerRootDir: root },
    ]

    const apps = await inferWorkspaceApps(root, layers)
    expect(apps?.map(app => app.layers)).toEqual([
      ['admin', 'shared-i18n', 'root'],
      ['shop', 'ui', 'shared-i18n', 'root'],
    ])
  })

  it('follows transitive dependency edges through packages that own no layer', async () => {
    const root = await createFixture({ workspace: 'pnpm' })
    await writeJson(join(root, 'packages/api/package.json'), {
      name: 'api',
      dependencies: { 'shared-i18n': 'workspace:*' },
    })
    await writeJson(join(root, 'apps/admin/package.json'), {
      name: 'admin',
      dependencies: { api: 'workspace:*' },
    })

    const apps = await inferWorkspaceApps(root, fixtureLayers(root))
    expect(apps?.find(app => app.name === 'admin')?.layers).toEqual(['admin', 'shared-i18n'])
  })
})

describe('inferWorkspaceApps — npm/yarn workspaces', () => {
  it('reads the workspaces array from the root package.json', async () => {
    const root = await createFixture({ workspace: 'npm' })

    expect((await inferWorkspaceApps(root, fixtureLayers(root)))?.map(app => app.name))
      .toEqual(['admin', 'shop'])
  })

  it('reads the { packages: [] } spelling too', async () => {
    const root = await createFixture({ workspace: 'npm-object' })

    expect((await inferWorkspaceApps(root, fixtureLayers(root)))?.map(app => app.name))
      .toEqual(['admin', 'shop'])
  })
})

describe('inferWorkspaceApps — refusals', () => {
  it('returns null when the project declares no workspace', async () => {
    const root = await createFixture({ workspace: 'none' })

    expect(await inferWorkspaceApps(root, fixtureLayers(root))).toBeNull()
  })

  it('returns null when no workspace package owns a layer', async () => {
    const root = await createFixture({ workspace: 'pnpm' })

    expect(await inferWorkspaceApps(root, [
      { path: join(root, 'locales'), layer: 'root', layerRootDir: root },
    ])).toBeNull()
  })

  it('returns null when only one app comes out of it', async () => {
    const root = await createFixture({ workspace: 'pnpm' })

    const layers = fixtureLayers(root).filter(layer => layer.layer !== 'admin')
    expect(await inferWorkspaceApps(root, layers)).toBeNull()
  })
})

// ─── pnpm-workspace.yaml reading ────────────────────────────────

describe('parsePnpmWorkspacePackages', () => {
  it('reads a block sequence, ignoring comments and later keys', () => {
    expect(parsePnpmWorkspacePackages([
      '# the workspace',
      'packages:',
      "  - 'apps/*'",
      '  # a comment',
      '  - packages/**',
      '  - "!packages/legacy"',
      '',
      'onlyBuiltDependencies:',
      '  - esbuild',
    ].join('\n'))).toEqual(['apps/*', 'packages/**', '!packages/legacy'])
  })

  it('reads a flow sequence', () => {
    expect(parsePnpmWorkspacePackages("packages: ['apps/*', \"packages/*\"]\n"))
      .toEqual(['apps/*', 'packages/*'])
  })

  it('returns nothing when the file declares no packages', () => {
    expect(parsePnpmWorkspacePackages('onlyBuiltDependencies:\n  - esbuild\n')).toEqual([])
  })
})

// ─── Detector wiring ────────────────────────────────────────────

describe('detectI18nConfig — consumer graph', () => {
  beforeEach(() => {
    clearConfigCache()
  })

  it('replaces the single placeholder app with the inferred graph', async () => {
    const root = await createFixture({ workspace: 'pnpm', projectConfig: {} })

    const config = await detectI18nConfig(root)
    expect(config.apps.map(app => ({ name: app.name, layers: app.layers, source: app.source }))).toEqual([
      { name: 'admin', layers: ['admin', 'shared-i18n'], source: 'workspace' },
      { name: 'shop', layers: ['shop', 'ui', 'shared-i18n'], source: 'workspace' },
    ])
  })

  it('a declared apps list beats the inference', async () => {
    const root = await createFixture({
      workspace: 'pnpm',
      projectConfig: {
        apps: [
          { name: 'storefront', layers: ['shop', 'ui', 'shared-i18n'] },
          { name: 'backoffice', layers: ['admin', 'ui', 'shared-i18n'] },
        ],
      },
    })

    const config = await detectI18nConfig(root)
    expect(config.apps).toEqual([
      {
        name: 'storefront',
        rootDir: root,
        layers: ['shop', 'ui', 'shared-i18n'],
        source: 'declared',
      },
      {
        name: 'backoffice',
        rootDir: root,
        layers: ['admin', 'ui', 'shared-i18n'],
        source: 'declared',
      },
    ])
  })

  it('consumerGraph: off keeps the adapter\'s single app', async () => {
    const root = await createFixture({ workspace: 'pnpm', projectConfig: { consumerGraph: 'off' } })

    const config = await detectI18nConfig(root)
    expect(config.apps).toEqual([
      {
        name: 'default',
        rootDir: root,
        layers: ['shop', 'admin', 'ui', 'shared-i18n'],
      },
    ])
  })
})
