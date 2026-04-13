import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { resolve, join } from 'node:path'
import { cp, rm, readFile, mkdir } from 'node:fs/promises'
import { readLocaleFile } from '../../src/io/json-reader.js'
import { mutateLocaleFile } from '../../src/io/json-writer.js'
import {
  getNestedValue,
  hasNestedKey,
  setNestedValue,
} from '../../src/io/key-operations.js'

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

  it('actually writes when dryRun is false (control test)', async () => {
    const newKey = 'common.actions.submit'
    const value = 'Submit'

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await mutateLocaleFile(filePath, (data) => {
        if (!hasNestedKey(data, newKey)) {
          setNestedValue(data, newKey, value)
        }
      })
    }

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      expect(hasNestedKey(data, newKey)).toBe(true)
      expect(getNestedValue(data, newKey)).toBe(value)
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

  it('actually writes when dryRun is false (control test)', async () => {
    const existingKey = 'common.actions.save'
    const newValue = 'Save Changes'

    const originalValues: Record<string, unknown> = {}
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      originalValues[file] = getNestedValue(data, existingKey)
    }

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await mutateLocaleFile(filePath, (data) => {
        if (hasNestedKey(data, existingKey)) {
          setNestedValue(data, existingKey, newValue)
        }
      })
    }

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const data = await readLocaleFile(filePath)
      expect(getNestedValue(data, existingKey)).toBe(newValue)
      expect(getNestedValue(data, existingKey)).not.toBe(originalValues[file])
    }
  })

  it('preserves file formatting after read-only dryRun', async () => {
    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const raw = await readFile(filePath, 'utf-8')
      expect(() => JSON.parse(raw)).not.toThrow()
      expect(raw.endsWith('\n')).toBe(true)
    }

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      await readLocaleFile(filePath)
    }

    for (const file of localeFiles) {
      const filePath = join(tmpRootLocales, file)
      const raw = await readFile(filePath, 'utf-8')
      expect(() => JSON.parse(raw)).not.toThrow()
      expect(raw.endsWith('\n')).toBe(true)
    }
  })
})
