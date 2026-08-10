/**
 * checkUndefinedKeys (#195) — the inverse of orphan scanning: keys
 * referenced in source code but defined in no locale file of the using
 * app's consumed layers. Covers scope-correct resolution over a multi-app
 * temp project, dynamic-usage downgrades to uncertain, ignorePatterns,
 * the no-app-info degenerate fallback, and the outputFile plumbing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { I18nConfig } from '../../src/config/types.js'
import type { CheckUndefinedKeysResult } from '../../src/core/ops-check.js'
import { createTempMultiAppConfig } from '../fixtures/config.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const adminPage = join('app-admin', 'pages/index.vue')
const { checkUndefinedKeys } = await import('../../src/core/operations.js')

let projectDir: string
let config: I18nConfig

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-check-undefined-'))
  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(projectDir, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }

  // Locale files: the root layer defines root.shared.used, each app layer
  // defines its own keys. Nothing defines admin.ghost or admin.dyn.*.
  await write('i18n/locales/de-DE.json', JSON.stringify({ root: { shared: { used: 'a' } } }))
  await write('app-admin/i18n/locales/de-DE.json', JSON.stringify({ admin: { used: 'a' } }))
  await write('app-shop/i18n/locales/de-DE.json', JSON.stringify({ shop: { only: 'a' } }))

  // Root-layer code uses a root key — clean.
  await write('components/Shared.vue', `{{ $t('root.shared.used') }}`)

  // app-admin exercises every classification (line numbers matter below).
  await write(adminPage, [
    `{{ $t('admin.used') }}`, // line 1: own layer — clean
    `{{ $t('root.shared.used') }}`, // line 2: consumed shared layer — clean
    `{{ $t('admin.ghost') }}`, // line 3: defined nowhere — undefined
    `{{ $t('shop.only') }}`, // line 4: only in non-consumed app-shop — undefined here
    'const label = t(`admin.dyn.${variant}`)', // line 5: dynamic — uncertain
    `{{ $te('admin.optional') }}`, // line 6: existence check only — uncertain
    `{{ $t('admin.ignored.x') }}`, // line 7: matches ignorePatterns — ignored
    `{{ $t('root.shared') }}`, // line 8: parent node of a leaf — clean
    `{{ $t('admin.ghost') }}`, // line 9: second usage aggregates
    `{{ $t('admin.concat.' + kind) }}`, // line 10: concat — dynamic uncertain, prefix never a hard finding
  ].join('\n'))

  // app-shop uses its own key — clean in its scope.
  await write('app-shop/pages/index.vue', `{{ $t('shop.only') }}`)

  config = {
    ...createTempMultiAppConfig(projectDir),
    projectConfig: {
      orphanScan: { 'app-admin': { ignorePatterns: ['admin.ignored.**'] } },
    },
  }
  holder.config = config
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
})

async function runCheck(): Promise<CheckUndefinedKeysResult> {
  const result = await checkUndefinedKeys({ projectDir })
  if ('reportFile' in result) throw new Error('Expected inline result, got report file')
  return result
}

/**
 * Run one check against a throwaway multi-app project built from `files`,
 * restoring the shared holder config afterwards (tests in this file share it).
 */
async function checkTempProject(prefix: string, files: Record<string, string>): Promise<CheckUndefinedKeysResult> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    for (const [rel, content] of Object.entries(files)) {
      const path = join(dir, rel)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    }
    holder.config = createTempMultiAppConfig(dir)
    const result = await checkUndefinedKeys({ projectDir: dir })
    if ('reportFile' in result) throw new Error('Expected inline result')
    return result
  } finally {
    holder.config = config
    await rm(dir, { recursive: true, force: true })
  }
}

describe('checkUndefinedKeys — scope-aware', () => {
  it('keys defined in a consumed layer (own, shared, or parent node) are clean', async () => {
    const result = await runCheck()

    const flagged = [...result.undefinedKeys, ...result.uncertainKeys].map(f => f.key)
    for (const clean of ['admin.used', 'root.shared.used', 'root.shared']) {
      expect(flagged).not.toContain(clean)
    }
  })

  it('reports a key defined nowhere with all its usage locations', async () => {
    const result = await runCheck()

    expect(result.undefinedKeys).toContainEqual({
      key: 'admin.ghost',
      app: 'app-admin',
      searchedLayers: ['root', 'app-admin'],
      usages: [
        { file: adminPage, line: 3 },
        { file: adminPage, line: 9 },
      ],
    })
  })

  it('a key defined only in a non-consumed app layer is undefined for the using app', async () => {
    const result = await runCheck()

    expect(result.undefinedKeys).toContainEqual(
      expect.objectContaining({ key: 'shop.only', app: 'app-admin' }),
    )
    // …but clean where the defining layer IS consumed.
    expect(result.undefinedKeys.filter(f => f.app === 'app-shop')).toEqual([])
    expect(result.undefinedKeys).toHaveLength(2)
  })

  it('dynamic usages and existence-check-only keys are uncertain, never hard findings', async () => {
    const result = await runCheck()

    expect(result.uncertainKeys).toContainEqual(
      expect.objectContaining({
        key: '`admin.dyn.${variant}`',
        app: 'app-admin',
        usages: [{ file: adminPage, line: 5 }],
      }),
    )
    expect(result.uncertainKeys).toContainEqual(
      expect.objectContaining({ key: 'admin.optional', app: 'app-admin' }),
    )
    const undefinedKeyNames = result.undefinedKeys.map(f => f.key)
    expect(undefinedKeyNames).not.toContain('`admin.dyn.${variant}`')
    expect(undefinedKeyNames).not.toContain('admin.optional')
  })

  it('concat usage: the quoted prefix is never a hard finding, the expression is uncertain', async () => {
    const result = await runCheck()

    // Static extraction also captures 'admin.concat.' from the concat call —
    // a trailing-dot artifact, not a key.
    expect(result.undefinedKeys.map(f => f.key)).not.toContain('admin.concat.')
    expect(result.uncertainKeys).toContainEqual(
      expect.objectContaining({
        key: '`admin.concat.${_}`',
        app: 'app-admin',
        usages: [{ file: adminPage, line: 10 }],
      }),
    )
  })

  it('respects orphanScan ignorePatterns and counts the exclusions', async () => {
    const result = await runCheck()

    const flagged = [...result.undefinedKeys, ...result.uncertainKeys].map(f => f.key)
    expect(flagged).not.toContain('admin.ignored.x')
    expect(result.summary.ignoredCount).toBe(1)
  })

  it('summarizes counts, locale, and per-app searched layers', async () => {
    const result = await runCheck()

    expect(result.summary).toMatchObject({
      usedKeysChecked: 8, // incl. the concat-prefix artifact captured statically
      undefinedCount: 2,
      uncertainCount: 3,
      ignoredCount: 1,
      filesScanned: 3,
      locale: 'de',
    })
    expect(result.summary.searchedLayersByApp).toEqual({
      'root': ['root'],
      'app-admin': ['root', 'app-admin'],
      'app-shop': ['root', 'app-shop'],
    })
    expect(result.summary.message).toContain('raw keys')
    expect(result.limitation).toContain('line-based')
  })

  it('no-app-info degenerate: a key defined in ANY layer counts as resolvable', async () => {
    holder.config = { ...config, apps: [] }
    try {
      const result = await runCheck()

      // shop.only now resolves for app-admin code too; only the truly
      // nowhere-defined key remains.
      expect(result.undefinedKeys).toEqual([
        expect.objectContaining({
          key: 'admin.ghost',
          searchedLayers: ['root', 'app-admin', 'app-shop'],
        }),
      ])
    } finally {
      holder.config = config
    }
  })

  it('multiline single-segment concat: the bare fallback downgrades matching static keys', async () => {
    // `t(` and the 'menu.' + suffix prefix on separate lines: only the
    // BARE_PREFIX_LITERAL fallback sees this usage. Its `menu.${_}` candidate
    // must downgrade the statically used, nowhere-defined menu.ghost from a
    // hard undefined finding to uncertain.
    const result = await checkTempProject('i18n-check-concat-', {
      'i18n/locales/de-DE.json': JSON.stringify({ root: { used: 'a' } }),
      'app-admin/i18n/locales/de-DE.json': '{}',
      'app-shop/i18n/locales/de-DE.json': '{}',
      'components/Menu.vue': [
        'const menuLabel = t(',
        `  'menu.' + suffix,`,
        ')',
        `{{ $t('menu.ghost') }}`,
      ].join('\n'),
    })

    expect(result.undefinedKeys).toEqual([])
    expect(result.uncertainKeys).toContainEqual(
      expect.objectContaining({
        key: 'menu.ghost',
        reason: expect.stringContaining('dynamic key pattern'),
      }),
    )
  })

  it('string-keys and package-namespaced keys are uncertain, never hard findings (#267)', async () => {
    // Mimics the bookings-api Laravel idioms: full-sentence JSON-style keys
    // (Nova labels, `__('Server Error')`) render as-is when unresolved, and
    // `namespace::group.key` resolves in vendor lang dirs this scan cannot
    // see. Both must land in uncertainKeys with distinct reasons.
    const result = await checkTempProject('i18n-check-stringkey-', {
      'i18n/locales/de-DE.json': JSON.stringify({ root: { used: 'a' } }),
      'app-admin/i18n/locales/de-DE.json': '{}',
      'app-shop/i18n/locales/de-DE.json': '{}',
      'components/Nova.vue': [
        `{{ $t('Server Error') }}`,
        `{{ $t('30 Days') }}`,
        `{{ $t('Logout') }}`,
        `{{ $t('accounting::messages.invoice.table.total') }}`,
        `{{ $t('admin.truly.missing') }}`,
      ].join('\n'),
    })

    // Only the well-shaped, nowhere-defined key stays a hard finding.
    expect(result.undefinedKeys.map(f => f.key)).toEqual(['admin.truly.missing'])
    for (const key of ['Server Error', '30 Days', 'Logout']) {
      expect(result.uncertainKeys).toContainEqual(
        expect.objectContaining({ key, reason: expect.stringContaining('string-key') }),
      )
    }
    expect(result.uncertainKeys).toContainEqual(
      expect.objectContaining({
        key: 'accounting::messages.invoice.table.total',
        reason: expect.stringContaining('package-namespaced'),
      }),
    )
  })

  it('honors outputFile: writes the full report and returns only the summary', async () => {
    const reportPath = join(projectDir, 'undefined-report.json')
    const result = await checkUndefinedKeys({ projectDir, outputFile: reportPath })

    expect(result).toEqual({
      reportFile: reportPath,
      summary: expect.objectContaining({ undefinedCount: 2, uncertainCount: 3 }),
    })

    const report = JSON.parse(await readFile(reportPath, 'utf-8')) as Record<string, unknown>
    expect(report.tool).toBe('find_undefined_keys')
    expect(report.undefinedKeys).toHaveLength(2)
  })
})
