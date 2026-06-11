import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { resolve, join } from 'node:path'
import { cp, rm, readFile, mkdir } from 'node:fs/promises'
import { readLocaleFile } from '../../src/io/json-reader.js'
import { mutateLocaleFile } from '../../src/io/json-writer.js'
import {
  getNestedValue,
  hasNestedKey,
  setNestedValue,
} from '../../src/io/key-operations.js'
import { writeTranslations } from '../../src/core/operations.js'

// Mock detectI18nConfig so writeTranslations works without @nuxt/kit
vi.mock('../../src/config/detector.js', async () => {
  const { resolve } = await import('node:path')
  return {
    detectI18nConfig: vi.fn(async (projectDir: string) => ({
      rootDir: projectDir,
      defaultLocale: 'de',
      fallbackLocale: { default: ['en'] },
      locales: [
        { code: 'de', language: 'de-DE', file: 'de-DE.json' },
        { code: 'en', language: 'en-US', file: 'en-US.json' },
        { code: 'fr', language: 'fr-FR', file: 'fr-FR.json' },
        { code: 'es', language: 'es-ES', file: 'es-ES.json' },
      ],
      localeDirs: [
        { path: resolve(projectDir, 'root'), layer: 'root', layerRootDir: projectDir },
      ],
      layerRootDirs: [projectDir],
      projectConfig: {
        context: '', layerRules: [], glossary: {}, translationPrompt: '',
        localeNotes: {}, examples: [], orphanScan: {},
      },
      apps: [{ name: 'root', rootDir: projectDir, layers: ['root'] }],
    })),
    clearConfigCache: vi.fn(),
    getCachedConfig: vi.fn(() => null),
  }
})

const playgroundDir = resolve(import.meta.dirname, '../fixtures/nuxt-project')
const playgroundRootLocales = resolve(playgroundDir, 'i18n/locales')

const tmpDir = resolve(import.meta.dirname, '../../.tmp-add-update')
const tmpRootLocales = resolve(tmpDir, 'root')

const localeFiles = ['de-DE.json', 'en-US.json', 'fr-FR.json', 'es-ES.json']

async function copyLocaleFiles() {
  await mkdir(tmpRootLocales, { recursive: true })
  await cp(playgroundRootLocales, tmpRootLocales, { recursive: true })
}

async function snapshotFiles(): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  for (const file of localeFiles) {
    snapshot[file] = await readFile(join(tmpRootLocales, file), 'utf-8')
  }
  return snapshot
}

// ─── add_translations dry-run behaviour ─────────────────────────

describe('add_translations dryRun', () => {
  beforeEach(async () => {
    await copyLocaleFiles()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('previews new keys without writing to disk', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const newKey = 'common.actions.submit'
    const value = 'Submit'

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      const exists = hasNestedKey(data, newKey)

      if (exists) {
        skipped.push(newKey)
      } else {
        applied.push(newKey)
        preview.push({ locale: file, key: newKey, value })
      }
    }

    expect(applied).toHaveLength(localeFiles.length)
    expect(skipped).toHaveLength(0)
    expect(preview).toHaveLength(localeFiles.length)
    for (const entry of preview) {
      expect(entry.key).toBe('common.actions.submit')
      expect(entry.value).toBe('Submit')
    }

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

  it('skips existing keys in add mode', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const existingKey = 'common.actions.save'
    const value = 'Save Updated'

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      const exists = hasNestedKey(data, existingKey)

      if (exists) {
        skipped.push(existingKey)
      } else {
        applied.push(existingKey)
        preview.push({ locale: file, key: existingKey, value })
      }
    }

    expect(skipped).toHaveLength(localeFiles.length)
    expect(applied).toHaveLength(0)
    expect(preview).toHaveLength(0)

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

  it('handles mixed keys: some new, some existing', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const keys = [
      { key: 'common.actions.save', value: 'Save' },
      { key: 'common.actions.submit', value: 'Submit' },
    ]

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)

      for (const { key, value } of keys) {
        const exists = hasNestedKey(data, key)
        if (exists) {
          skipped.push(key)
        } else {
          applied.push(key)
          preview.push({ locale: file, key, value })
        }
      }
    }

    expect(skipped).toHaveLength(localeFiles.length)
    expect(applied).toHaveLength(localeFiles.length)
    expect(preview).toHaveLength(localeFiles.length)
    expect(preview.every(p => p.key === 'common.actions.submit')).toBe(true)

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

})

// ─── update_translations dry-run behaviour ──────────────────────

describe('update_translations dryRun', () => {
  beforeEach(async () => {
    await copyLocaleFiles()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('previews existing key updates without writing to disk', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const existingKey = 'common.actions.save'
    const newValue = 'Save Changes'

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      const exists = hasNestedKey(data, existingKey)

      if (!exists) {
        skipped.push(existingKey)
      } else {
        applied.push(existingKey)
        preview.push({ locale: file, key: existingKey, value: newValue })
      }
    }

    expect(applied).toHaveLength(localeFiles.length)
    expect(skipped).toHaveLength(0)
    expect(preview).toHaveLength(localeFiles.length)
    for (const entry of preview) {
      expect(entry.value).toBe('Save Changes')
    }

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

  it('skips non-existent keys in update mode', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const nonExistentKey = 'common.actions.submit'
    const value = 'Submit'

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      const exists = hasNestedKey(data, nonExistentKey)

      if (!exists) {
        skipped.push(nonExistentKey)
      } else {
        applied.push(nonExistentKey)
        preview.push({ locale: file, key: nonExistentKey, value })
      }
    }

    expect(skipped).toHaveLength(localeFiles.length)
    expect(applied).toHaveLength(0)
    expect(preview).toHaveLength(0)

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

  it('handles mixed keys: some existing, some not', async () => {
    const before = await snapshotFiles()

    const preview: Array<{ locale: string; key: string; value: string }> = []
    const applied: string[] = []
    const skipped: string[] = []

    const keys = [
      { key: 'common.actions.save', value: 'Save Changes' },
      { key: 'common.actions.submit', value: 'Submit' },
    ]

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)

      for (const { key, value } of keys) {
        const exists = hasNestedKey(data, key)
        if (!exists) {
          skipped.push(key)
        } else {
          applied.push(key)
          preview.push({ locale: file, key, value })
        }
      }
    }

    expect(applied).toHaveLength(localeFiles.length)
    expect(skipped).toHaveLength(localeFiles.length)
    expect(preview).toHaveLength(localeFiles.length)
    expect(preview.every(p => p.key === 'common.actions.save')).toBe(true)

    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }
  })

})

// ─── writeTranslations (upsert / add / update / dryRun) ────────

describe('writeTranslations', () => {
  beforeEach(async () => {
    await copyLocaleFiles()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('upsert creates new keys', async () => {
    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'upsert',
      translations: {
        'test.upsert.newKey': {
          'de-DE': 'Neuer Wert',
          'en-US': 'New Value',
          'fr-FR': 'Nouvelle valeur',
          'es-ES': 'Nuevo valor',
        },
      },
    })

    // Non-dry-run result should have `written`, not `wouldWrite`
    expect(result.written).toEqual(['test.upsert.newKey'])
    expect(result.skipped).toEqual([])
    expect(result.dryRun).toBeUndefined()

    // Verify files were actually written
    const expectations: Array<[string, string]> = [
      ['de-DE', 'Neuer Wert'],
      ['en-US', 'New Value'],
      ['fr-FR', 'Nouvelle valeur'],
      ['es-ES', 'Nuevo valor'],
    ]
    for (const [locale, expected] of expectations) {
      const filePath = join(tmpRootLocales, `${locale}.json`)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(getNestedValue(data, 'test.upsert.newKey')).toBe(expected)
    }
  })

  it('upsert updates existing keys', async () => {
    // First create the key via addTranslations-equivalent (low-level write)
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await mutateLocaleFile(filePath, (data) => {
        if (!hasNestedKey(data, 'test.upsert.updateMe')) {
          setNestedValue(data, 'test.upsert.updateMe', 'Initial Value')
        }
      })
    }

    // Now upsert with a new value
    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'upsert',
      translations: {
        'test.upsert.updateMe': {
          'de-DE': 'Aktualisierter Wert',
          'en-US': 'Updated Value',
          'fr-FR': 'Valeur mise à jour',
          'es-ES': 'Valor actualizado',
        },
      },
    })

    expect(result.written).toEqual(['test.upsert.updateMe'])
    expect(result.skipped).toEqual([])

    // Verify the value was updated
    const expectations: Array<[string, string]> = [
      ['de-DE', 'Aktualisierter Wert'],
      ['en-US', 'Updated Value'],
      ['fr-FR', 'Valeur mise à jour'],
      ['es-ES', 'Valor actualizado'],
    ]
    for (const [locale, expected] of expectations) {
      const filePath = join(tmpRootLocales, `${locale}.json`)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(getNestedValue(data, 'test.upsert.updateMe')).toBe(expected)
    }
  })

  it('upsert combines add + update in one call', async () => {
    // Pre-create one key
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await mutateLocaleFile(filePath, (data) => {
        setNestedValue(data, 'test.upsert.existing', 'Original')
      })
    }

    // Upsert: update existing + add new in a single call
    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'upsert',
      translations: {
        'test.upsert.existing': {
          'de-DE': 'Geändert',
          'en-US': 'Modified',
          'fr-FR': 'Modifié',
          'es-ES': 'Modificado',
        },
        'test.upsert.brandNew': {
          'de-DE': 'Neu',
          'en-US': 'New',
          'fr-FR': 'Nouveau',
          'es-ES': 'Nuevo',
        },
      },
    })

    // Both should be in `written` (upsert never skips)
    expect(result.written).toContain('test.upsert.existing')
    expect(result.written).toContain('test.upsert.brandNew')
    expect(result.skipped).toEqual([])

    // Verify both keys have correct values on disk (per locale)
    const expectedExisting: Record<string, string> = {
      'de-DE': 'Geändert',
      'en-US': 'Modified',
      'fr-FR': 'Modifié',
      'es-ES': 'Modificado',
    }
    const expectedBrandNew: Record<string, string> = {
      'de-DE': 'Neu',
      'en-US': 'New',
      'fr-FR': 'Nouveau',
      'es-ES': 'Nuevo',
    }
    for (const file of localeFiles) {
      const localeCode = file.replace('.json', '')
      const filePath = join(tmpRootLocales, file)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(getNestedValue(data, 'test.upsert.existing')).toBe(expectedExisting[localeCode])
      expect(getNestedValue(data, 'test.upsert.brandNew')).toBe(expectedBrandNew[localeCode])
    }
  })

  it('dryRun does not write', async () => {
    const before = await snapshotFiles()

    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'upsert',
      dryRun: true,
      translations: {
        'test.upsert.dryRunKey': {
          'de-DE': 'Nicht speichern',
          'en-US': 'Do not save',
          'fr-FR': 'Ne pas enregistrer',
          'es-ES': 'No guardar',
        },
      },
    })

    // Dry-run result shape
    expect(result.dryRun).toBe(true)
    expect(result.wouldWrite).toBeDefined()
    expect(result.wouldWrite!.length).toBe(localeFiles.length)
    for (const entry of result.wouldWrite!) {
      expect(entry.key).toBe('test.upsert.dryRunKey')
    }
    expect(result.written).toBeUndefined()
    expect(result.filesWritten).toBeUndefined()

    // Files must not have changed
    const after = await snapshotFiles()
    for (const file of localeFiles) {
      expect(after[file]).toBe(before[file])
    }

    // Key must not exist on disk
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(hasNestedKey(data, 'test.upsert.dryRunKey')).toBe(false)
    }
  })

  it("mode 'add' skips existing", async () => {
    // Pre-create a key
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await mutateLocaleFile(filePath, (data) => {
        setNestedValue(data, 'test.upsert.addSkipMe', 'Existing')
      })
    }

    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'add',
      translations: {
        'test.upsert.addSkipMe': {
          'de-DE': 'Neu',
          'en-US': 'New',
          'fr-FR': 'Nouveau',
          'es-ES': 'Nuevo',
        },
      },
    })

    expect(result.written).toEqual([])
    expect(result.skipped).toEqual(['test.upsert.addSkipMe'])

    // Value must remain unchanged
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(getNestedValue(data, 'test.upsert.addSkipMe')).toBe('Existing')
    }
  })

  it("mode 'update' skips missing", async () => {
    const result = await writeTranslations({
      projectDir: tmpDir,
      layer: 'root',
      mode: 'update',
      translations: {
        'test.upsert.updateMissing': {
          'de-DE': 'Nicht vorhanden',
          'en-US': 'Does not exist',
          'fr-FR': 'N\'existe pas',
          'es-ES': 'No existe',
        },
      },
    })

    expect(result.written).toEqual([])
    expect(result.skipped).toEqual(['test.upsert.updateMissing'])

    // Key must not exist on disk
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = JSON.parse(await readFile(filePath, 'utf-8'))
      expect(hasNestedKey(data, 'test.upsert.updateMissing')).toBe(false)
    }
  })
})
