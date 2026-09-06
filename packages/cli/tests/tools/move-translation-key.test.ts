import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Moving a key between layers used to mean composing get + write + remove:
 * three calls across up to thirty locales, with a truncation between the last
 * two leaving the key in both layers (#341). These tests are about the failure
 * modes that composition could not avoid — a conflict must write nothing at
 * all, and every locale must travel, not just the reference one.
 */
let tempDir: string

vi.mock('../../src/config/detector.js', async () => {
  const { resolve } = await import('node:path')
  return {
    detectI18nConfig: vi.fn(async (projectDir: string) => ({
      rootDir: projectDir,
      defaultLocale: 'de',
      fallbackLocale: { default: ['de'] },
      locales: [
        { code: 'de', language: 'de-DE', file: 'de-DE.json' },
        { code: 'en', language: 'en-GB', file: 'en-GB.json' },
        { code: 'fr', language: 'fr-FR', file: 'fr-FR.json' },
      ],
      localeDirs: [
        { path: resolve(projectDir, 'i18n/locales'), layer: 'root', layerRootDir: projectDir },
        { path: resolve(projectDir, 'app-admin/i18n/locales'), layer: 'app-admin', layerRootDir: resolve(projectDir, 'app-admin') },
        { path: resolve(projectDir, 'app-shop/i18n/locales'), layer: 'app-shop', layerRootDir: resolve(projectDir, 'app-shop'), aliasOf: 'app-admin' },
      ],
      layerRootDirs: [projectDir, resolve(projectDir, 'app-admin')],
      projectConfig: {},
      apps: [
        { name: 'app-admin', rootDir: resolve(projectDir, 'app-admin'), layers: ['app-admin', 'root'] },
      ],
    })),
    clearConfigCache: vi.fn(),
    getCachedConfig: vi.fn(() => null),
  }
})

const { moveTranslationKey } = await import('../../src/core/operations.js')

const LOCALE_FILES = { de: 'de-DE.json', en: 'en-GB.json', fr: 'fr-FR.json' } as const

async function seed(layerDir: string, contents: Partial<Record<keyof typeof LOCALE_FILES, unknown>>) {
  await mkdir(resolve(tempDir, layerDir), { recursive: true })
  for (const [locale, file] of Object.entries(LOCALE_FILES)) {
    const data = contents[locale as keyof typeof LOCALE_FILES] ?? {}
    await writeFile(resolve(tempDir, layerDir, file), `${JSON.stringify(data, null, 2)}\n`)
  }
}

async function read(layerDir: string, locale: keyof typeof LOCALE_FILES): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(tempDir, layerDir, LOCALE_FILES[locale]), 'utf-8')) as Record<string, unknown>
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'i18n-move-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('moveTranslationKey', () => {
  it('carries every locale that defines the key, not just the reference one', async () => {
    await seed('app-admin/i18n/locales', {
      de: { calendar: { views: { save: 'Speichern' } } },
      en: { calendar: { views: { save: 'Save' } } },
      fr: { calendar: { views: { save: 'Enregistrer' } } },
    })
    await seed('i18n/locales', {})

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.views.save',
      projectDir: tempDir,
    })

    expect(result.movedLocales).toEqual(['de', 'en', 'fr'])
    expect((await read('i18n/locales', 'fr')).calendar).toEqual({ views: { save: 'Enregistrer' } })
    // The source is left clean rather than holding an empty husk: removing the
    // last key of a namespace prunes the namespace too.
    expect((await read('app-admin/i18n/locales', 'fr')).calendar).toBeUndefined()
  })

  it('renames while moving, so a promoted key can take the shared layer’s naming', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { views: { save: 'Speichern' } } } })
    await seed('i18n/locales', {})

    await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.views.save',
      newKey: 'common.actions.save',
      projectDir: tempDir,
    })

    expect((await read('i18n/locales', 'de')).common).toEqual({ actions: { save: 'Speichern' } })
  })

  // The failure the three-call composition could not avoid: a divergent target
  // in one locale must not leave the other locales half-moved.
  it('writes nothing at all when any locale conflicts', async () => {
    await seed('app-admin/i18n/locales', {
      de: { calendar: { save: 'Speichern' } },
      en: { calendar: { save: 'Save' } },
      fr: { calendar: { save: 'Enregistrer' } },
    })
    await seed('i18n/locales', { fr: { calendar: { save: 'Sauvegarder' } } })

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.save',
      projectDir: tempDir,
    })

    expect(result.conflictsInLocales).toEqual(['fr'])
    expect(result.movedLocales).toBeUndefined()
    // Both ends untouched — including the locales that had no conflict.
    expect((await read('i18n/locales', 'de')).calendar).toBeUndefined()
    expect((await read('app-admin/i18n/locales', 'de')).calendar).toEqual({ save: 'Speichern' })
  })

  it('treats an identical target value as a duplicate to resolve, not a conflict', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } }, en: { calendar: { save: 'Save' } } })
    await seed('i18n/locales', { de: { calendar: { save: 'Speichern' } } })

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.save',
      projectDir: tempDir,
    })

    expect(result.deduplicatedLocales).toEqual(['de'])
    expect(result.movedLocales).toEqual(['en'])
    // The source copy goes either way — that is the duplication being removed.
    expect((await read('app-admin/i18n/locales', 'de')).calendar).toBeUndefined()
    expect((await read('i18n/locales', 'de')).calendar).toEqual({ save: 'Speichern' })
  })

  it('reports locales the source layer never defined rather than skipping them', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } } })
    await seed('i18n/locales', {})

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.save',
      projectDir: tempDir,
    })

    expect(result.notFoundInLocales).toEqual(['en', 'fr'])
    expect(result.movedLocales).toEqual(['de'])
  })

  it('previews the plan without writing when dryRun is set', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } } })
    await seed('i18n/locales', {})

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'root',
      key: 'calendar.save',
      dryRun: true,
      projectDir: tempDir,
    })

    expect(result.dryRun).toBe(true)
    expect(result.wouldMove).toEqual([{ locale: 'de', value: 'Speichern', action: 'move' }])
    expect((await read('i18n/locales', 'de')).calendar).toBeUndefined()
    expect((await read('app-admin/i18n/locales', 'de')).calendar).toEqual({ save: 'Speichern' })
  })

  // Naming no other layer is not an error to correct but the other half of the
  // operation: the key stays where it is and takes a new path.
  it('renames in place when no other layer is named', async () => {
    await seed('app-admin/i18n/locales', {
      de: { calendar: { save: 'Speichern' } },
      en: { calendar: { save: 'Save' } },
    })

    const result = await moveTranslationKey({
      layer: 'app-admin',
      key: 'calendar.save',
      newKey: 'calendar.store',
      projectDir: tempDir,
    })

    expect(result.renamed).toEqual(['de', 'en'])
    expect(result.summary?.localesAffected).toBe(2)
    expect((await read('app-admin/i18n/locales', 'de')).calendar).toEqual({ store: 'Speichern' })
    expect((await read('app-admin/i18n/locales', 'en')).calendar).toEqual({ store: 'Save' })
  })

  it('treats the same layer named twice as that same rename', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } } })

    const result = await moveTranslationKey({
      layer: 'app-admin',
      toLayer: 'app-admin',
      key: 'calendar.save',
      newKey: 'calendar.store',
      projectDir: tempDir,
    })

    expect(result.renamed).toEqual(['de'])
  })

  // Neither destination given means the call describes no change at all, which
  // is a mistake worth naming rather than a no-op worth reporting as success.
  it('refuses a call that names neither a target layer nor a new key', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } } })

    await expect(moveTranslationKey({
      layer: 'app-admin',
      key: 'calendar.save',
      projectDir: tempDir,
    })).rejects.toThrow(/toLayer|newKey/)
  })

  // An alias layer's files belong to the layer it points at, so writing "into"
  // one would land the key somewhere the caller did not name.
  it('refuses an alias layer as either end', async () => {
    await seed('app-admin/i18n/locales', { de: { calendar: { save: 'Speichern' } } })
    await seed('i18n/locales', {})

    await expect(moveTranslationKey({
      layer: 'root', toLayer: 'app-shop', key: 'calendar.save', projectDir: tempDir,
    })).rejects.toThrow(/alias/)
  })
})
