/**
 * Declared namespaces: key patterns that exist by contract rather than by a
 * call site (sent by a backend, keyed by runtime data, built from a registry).
 *
 * What is covered here: the keys are never orphans and never removed, every
 * declaration is reported with the keys it covers — so one that covers nothing
 * is visible — and `check --write` refuses to extract a key that is defined by
 * the contract somewhere else.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { I18nConfig, ProjectConfig } from '../../src/config/types.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const { findOrphanKeys, removeOrphanKeys, checkUndefinedKeys } = await import('../../src/core/operations.js')

const WIRE_REASON = 'sent by bookings-api as name_key'
const MAILER_REASON = 'rendered by the mailer from a template registry'

function singleLayerConfig(dir: string, projectConfig: ProjectConfig): I18nConfig {
  return {
    rootDir: dir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: [{ code: 'de', language: 'de-DE', file: 'de-DE.json' }],
    localeDirs: [{ path: join(dir, 'i18n/locales'), layer: 'root', layerRootDir: dir }],
    layerRootDirs: [dir],
    apps: [{ name: 'root', rootDir: dir, layers: ['root'] }],
    projectConfig,
  }
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

const readJson = async (path: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(path, 'utf-8')) as Record<string, any>

describe('findOrphanKeys — declared namespaces', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'i18n-declared-orphans-'))
    await writeFiles(projectDir, {
      'i18n/locales/de-DE.json': JSON.stringify({
        views: { defaults: { displayApp: 'a', displayList: 'b' } },
        home: { title: 'c' },
        legal: { terms: 'd' },
        stale: { key: 'e' },
      }),
      // The wire-driven keys are named nowhere: the backend sends them.
      'pages/index.vue': `{{ $t('home.title') }}`,
    })
    holder.config = singleLayerConfig(projectDir, {
      declaredNamespaces: [
        { pattern: 'views.defaults.**', reason: WIRE_REASON },
        { pattern: 'emails.wire.**', reason: MAILER_REASON },
      ],
      orphanScan: { root: { ignorePatterns: ['legal.**'] } },
    })
  })

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('keeps declared keys out of the orphan list and counts them apart from ignore patterns', async () => {
    const result = await findOrphanKeys({ projectDir })

    expect(result.orphanKeys).toEqual({ root: ['stale.key'] })
    expect(result.summary.declaredCount).toBe(2)
    expect(result.summary.ignoredCount).toBe(1)
  })

  it('lists every declaration with its reason and the keys it covers', async () => {
    const result = await findOrphanKeys({ projectDir })

    expect(result.declaredNamespaces).toEqual([
      {
        pattern: 'views.defaults.**',
        reason: WIRE_REASON,
        matchedKeys: ['views.defaults.displayApp', 'views.defaults.displayList'],
      },
      { pattern: 'emails.wire.**', reason: MAILER_REASON, matchedKeys: [] },
    ])
    expect(result.declaredNamespaceNote).toContain('matchedKeys')
  })

  it('a declaration covering no key is reported with an empty match list', async () => {
    const result = await findOrphanKeys({ projectDir })

    const stale = result.declaredNamespaces?.filter(d => d.matchedKeys.length === 0)
    expect(stale?.map(d => d.pattern)).toEqual(['emails.wire.**'])
  })

  it('reports nothing about declarations when the project declares none', async () => {
    holder.config = singleLayerConfig(projectDir, {})
    try {
      const result = await findOrphanKeys({ projectDir })

      expect(result.declaredNamespaces).toBeUndefined()
      expect(result.declaredNamespaceNote).toBeUndefined()
      // Without the declaration the wire-driven keys are exactly the report
      // that nearly cost a project its catalog.
      expect(result.orphanKeys.root).toContain('views.defaults.displayApp')
    } finally {
      holder.config = singleLayerConfig(projectDir, {
        declaredNamespaces: [
          { pattern: 'views.defaults.**', reason: WIRE_REASON },
          { pattern: 'emails.wire.**', reason: MAILER_REASON },
        ],
        orphanScan: { root: { ignorePatterns: ['legal.**'] } },
      })
    }
  })
})

describe('removeOrphanKeys — declared namespaces', () => {
  it('deletes the orphans and leaves the declared keys in the locale file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'i18n-declared-remove-'))
    try {
      await writeFiles(dir, {
        'i18n/locales/de-DE.json': JSON.stringify({
          views: { defaults: { displayApp: 'a' } },
          stale: { key: 'e' },
        }),
        'pages/index.vue': `<template><div /></template>`,
      })
      holder.config = singleLayerConfig(dir, {
        declaredNamespaces: [{ pattern: 'views.defaults.**', reason: WIRE_REASON }],
      })

      const result = await removeOrphanKeys({ projectDir: dir, dryRun: false })

      expect(result.removed).toEqual({ root: ['stale.key'] })
      expect(result.summary.declaredCount).toBe(1)
      expect(result.declaredNamespaces).toEqual([
        { pattern: 'views.defaults.**', reason: WIRE_REASON, matchedKeys: ['views.defaults.displayApp'] },
      ])
      expect(await readJson(join(dir, 'i18n/locales/de-DE.json'))).toEqual({
        views: { defaults: { displayApp: 'a' } },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('checkUndefinedKeys — declared namespaces', () => {
  it('never reports or writes a key the contract defines elsewhere', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'i18n-declared-check-'))
    try {
      await writeFiles(dir, {
        'i18n/locales/de-DE.json': JSON.stringify({ root: { used: 'Benutzt' } }),
        'pages/index.vue': [
          `{{ $t('root.used') }}`,
          `{{ $t('root.ghost') }}`,
          // Keyed by HTTP status at runtime; the catalog for it lives with the
          // contract, not in this project.
          `{{ $t('common.errors.404.title') }}`,
        ].join('\n'),
      })
      holder.config = singleLayerConfig(dir, {
        declaredNamespaces: [{ pattern: 'common.errors.**', reason: 'keyed by HTTP status, catalog owned by the API' }],
      })

      const result = await checkUndefinedKeys({ projectDir: dir, write: true })

      expect(result.undefinedKeys.map(f => f.key)).toEqual(['root.ghost'])
      expect(result.summary.declaredCount).toBe(1)
      expect(result.written).toEqual({ layer: 'root', locale: 'de', keys: ['root.ghost'] })

      const de = await readJson(join(dir, 'i18n/locales/de-DE.json'))
      expect(de).toEqual({ root: { used: 'Benutzt', ghost: '' } })
      expect(JSON.stringify(de)).not.toContain('common')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
