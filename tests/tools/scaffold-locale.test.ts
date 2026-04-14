import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { resolve, join } from 'node:path'
import { cp, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readLocaleFile } from '../../src/io/json-reader.js'
import { readPhpLocaleFile } from '../../src/io/php-reader.js'
import { getLeafKeys, getNestedValue } from '../../src/io/key-operations.js'
import type { I18nConfig, LocaleDefinition } from '../../src/config/types.js'
import { scaffoldLocale, buildEmptyStructure } from '../../src/tools/scaffold-locale.js'

const fixtureDir = resolve(import.meta.dirname, '../fixtures/nuxt-project')
const tmpDir = resolve(import.meta.dirname, '../../.tmp-scaffold-locale')
const tmpRootLocales = resolve(tmpDir, 'root')
const tmpAdminLocales = resolve(tmpDir, 'admin')

const fixtureRootLocales = resolve(fixtureDir, 'i18n/locales')
const fixtureAdminLocales = resolve(fixtureDir, 'app-admin/i18n/locales')

const existingLocales: LocaleDefinition[] = [
  { code: 'de', language: 'de-DE', file: 'de-DE.json' },
  { code: 'en', language: 'en-US', file: 'en-US.json' },
  { code: 'fr', language: 'fr-FR', file: 'fr-FR.json' },
  { code: 'es', language: 'es-ES', file: 'es-ES.json' },
]

function createTestConfig(locales: LocaleDefinition[]): I18nConfig {
  return {
    rootDir: tmpDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales,
    localeDirs: [
      {
        path: tmpRootLocales,
        layer: 'root',
        layerRootDir: tmpDir,
      },
    ],
    layerRootDirs: [tmpDir],
  }
}

function createMultiLayerConfig(locales: LocaleDefinition[]): I18nConfig {
  return {
    rootDir: tmpDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales,
    localeDirs: [
      {
        path: tmpRootLocales,
        layer: 'root',
        layerRootDir: tmpDir,
      },
      {
        path: tmpAdminLocales,
        layer: 'app-admin',
        layerRootDir: resolve(tmpDir, 'admin'),
      },
    ],
    layerRootDirs: [tmpDir, resolve(tmpDir, 'admin')],
  }
}

async function copyFixtureLocales() {
  await mkdir(tmpRootLocales, { recursive: true })
  await mkdir(tmpAdminLocales, { recursive: true })
  await cp(fixtureRootLocales, tmpRootLocales, { recursive: true })
  await cp(fixtureAdminLocales, tmpAdminLocales, { recursive: true })
}

describe('scaffoldLocale', () => {
  beforeEach(async () => {
    await copyFixtureLocales()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a new locale file with the reference locale key structure', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createTestConfig([...existingLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['sv'] })

    const svFile = join(tmpRootLocales, 'sv-SE.json')
    expect(existsSync(svFile)).toBe(true)

    const svData = await readLocaleFile(svFile)
    expect(svData).toHaveProperty('common.actions.cancel', '')
    expect(svData).toHaveProperty('common.actions.delete', '')
    expect(svData).toHaveProperty('common.actions.save', '')
    expect(svData).toHaveProperty('common.messages.loading', '')

    expect(result.created.length).toBe(1)
    expect(result.created[0].locale).toBe('sv')
    expect(result.created[0].layer).toBe('root')
  })

  it('scaffolds across all layers when no layer is specified', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createMultiLayerConfig([...existingLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['sv'] })

    expect(result.created.length).toBe(2)
    expect(result.created.map(f => f.layer).sort()).toEqual(['app-admin', 'root'])

    const svRootFile = join(tmpRootLocales, 'sv-SE.json')
    expect(existsSync(svRootFile)).toBe(true)
    const svRootData = await readLocaleFile(svRootFile)
    expect(svRootData).toHaveProperty('common.actions.cancel', '')

    const svAdminFile = join(tmpAdminLocales, 'sv-SE.json')
    expect(existsSync(svAdminFile)).toBe(true)
    const svAdminData = await readLocaleFile(svAdminFile)
    expect(svAdminData).toHaveProperty('admin.dashboard.title', '')
    expect(svAdminData).toHaveProperty('admin.users.list', '')
  })

  it('scopes to a single layer when layer option is specified', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createMultiLayerConfig([...existingLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['sv'], layer: 'app-admin' })

    expect(result.created.length).toBe(1)
    expect(result.created[0].layer).toBe('app-admin')

    expect(existsSync(join(tmpAdminLocales, 'sv-SE.json'))).toBe(true)
    expect(existsSync(join(tmpRootLocales, 'sv-SE.json'))).toBe(false)
  })

  it('dry run returns plan but writes no files', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createTestConfig([...existingLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['sv'], dryRun: true })

    expect(result.created.length).toBe(1)
    expect(result.created[0].locale).toBe('sv')
    expect(result.created[0].keys).toBeGreaterThan(0)

    const svFile = join(tmpRootLocales, 'sv-SE.json')
    expect(existsSync(svFile)).toBe(false)
  })

  it('auto-detects new locales when locales option is omitted', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const jaLocale: LocaleDefinition = { code: 'ja', language: 'ja-JP', file: 'ja-JP.json' }
    const config = createTestConfig([...existingLocales, svLocale, jaLocale])

    const result = await scaffoldLocale(config)

    expect(result.created.length).toBe(2)
    expect(result.created.map(f => f.locale).sort()).toEqual(['ja', 'sv'])
    expect(result.skipped).toEqual([])
  })

  it('skips locales that already have files and reports them', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createTestConfig([...existingLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['de', 'sv'] })

    expect(result.created.length).toBe(1)
    expect(result.created[0].locale).toBe('sv')

    expect(result.skipped.length).toBe(1)
    expect(result.skipped[0].locale).toBe('de')
    expect(result.skipped[0].layer).toBe('root')
  })

  it('throws LOCALE_NOT_FOUND when an explicit locale is not found in config', async () => {
    const config = createTestConfig(existingLocales)

    await expect(scaffoldLocale(config, { locales: ['sv'] }))
      .rejects.toMatchObject({ code: 'LOCALE_NOT_FOUND' })
  })

  it('returns empty created array when all requested locales already have files', async () => {
    const config = createTestConfig(existingLocales)

    const result = await scaffoldLocale(config, { locales: ['de', 'en'] })

    expect(result.created).toEqual([])
    expect(result.skipped.length).toBe(2)
  })

  it('throws LAYER_NOT_FOUND when layer does not exist', async () => {
    const config = createTestConfig(existingLocales)

    await expect(scaffoldLocale(config, { layer: 'nonexistent' }))
      .rejects.toMatchObject({ code: 'LAYER_NOT_FOUND' })
  })

  it('throws LAYER_IS_ALIAS when targeting an alias layer', async () => {
    const config: I18nConfig = {
      ...createTestConfig(existingLocales),
      localeDirs: [
        { path: tmpRootLocales, layer: 'root', layerRootDir: tmpDir },
        { path: tmpRootLocales, layer: 'root-alias', layerRootDir: tmpDir, aliasOf: 'root' },
      ],
    }

    await expect(scaffoldLocale(config, { layer: 'root-alias' }))
      .rejects.toMatchObject({ code: 'LAYER_IS_ALIAS' })
  })

  it('every leaf value in the scaffolded file is an empty string', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE', file: 'sv-SE.json' }
    const config = createTestConfig([...existingLocales, svLocale])

    await scaffoldLocale(config, { locales: ['sv'] })

    const refData = await readLocaleFile(join(tmpRootLocales, 'de-DE.json'))
    const svData = await readLocaleFile(join(tmpRootLocales, 'sv-SE.json'))

    const refKeys = getLeafKeys(refData)
    const svKeys = getLeafKeys(svData)

    expect(svKeys).toEqual(refKeys)
    for (const key of svKeys) {
      expect(getNestedValue(svData, key)).toBe('')
    }
  })
})

describe('buildEmptyStructure', () => {
  it('empties strings, preserves nested objects, and leaves non-string values untouched', () => {
    const input = {
      greeting: 'Hello',
      nested: {
        deep: 'World',
        count: 42,
        tags: ['a', 'b'],
        flag: true,
        empty: null,
      },
    }

    const result = buildEmptyStructure(input)

    expect(result).toEqual({
      greeting: '',
      nested: {
        deep: '',
        count: 42,
        tags: ['a', 'b'],
        flag: true,
        empty: null,
      },
    })
  })
})

describe('scaffoldLocale (Laravel)', () => {
  const tmpLaravelDir = resolve(import.meta.dirname, '../../.tmp-scaffold-laravel')
  const tmpLangDir = resolve(tmpLaravelDir, 'lang')

  const laravelLocales: LocaleDefinition[] = [
    { code: 'de', language: 'de-DE' },
    { code: 'en', language: 'en-US' },
  ]

  function createLaravelConfig(locales: LocaleDefinition[]): I18nConfig {
    return {
      framework: 'laravel',
      rootDir: tmpLaravelDir,
      defaultLocale: 'de',
      fallbackLocale: { default: ['en'] },
      locales,
      localeDirs: [
        {
          path: tmpLangDir,
          layer: 'lang',
          layerRootDir: tmpLaravelDir,
        },
      ],
      layerRootDirs: [tmpLaravelDir],
      localeFileFormat: 'php-array',
    }
  }

  async function createLaravelFixtures() {
    const deDir = join(tmpLangDir, 'de')
    const enDir = join(tmpLangDir, 'en')
    await mkdir(deDir, { recursive: true })
    await mkdir(enDir, { recursive: true })

    await writeFile(join(deDir, 'auth.php'), `<?php\n\nreturn [\n    "failed" => "Falsche Daten.",\n    "password" => "Falsches Passwort.",\n];\n`)
    await writeFile(join(deDir, 'common.php'), `<?php\n\nreturn [\n    "greeting" => "Hallo",\n    "save" => "Speichern",\n];\n`)
    await writeFile(join(enDir, 'auth.php'), `<?php\n\nreturn [\n    "failed" => "Wrong credentials.",\n    "password" => "Wrong password.",\n];\n`)
    await writeFile(join(enDir, 'common.php'), `<?php\n\nreturn [\n    "greeting" => "Hello",\n    "save" => "Save",\n];\n`)
  }

  beforeEach(async () => {
    await createLaravelFixtures()
  })

  afterEach(async () => {
    await rm(tmpLaravelDir, { recursive: true, force: true })
  })

  it('creates one PHP file per namespace in a new locale directory', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE' }
    const config = createLaravelConfig([...laravelLocales, svLocale])

    const result = await scaffoldLocale(config, { locales: ['sv'] })

    const svAuthFile = join(tmpLangDir, 'sv', 'auth.php')
    const svCommonFile = join(tmpLangDir, 'sv', 'common.php')

    expect(existsSync(svAuthFile)).toBe(true)
    expect(existsSync(svCommonFile)).toBe(true)

    const authData = await readPhpLocaleFile(svAuthFile)
    expect(authData).toEqual({ failed: '', password: '' })

    const commonData = await readPhpLocaleFile(svCommonFile)
    expect(commonData).toEqual({ greeting: '', save: '' })

    expect(result.created.length).toBe(2)
    expect(result.created.map(f => f.file).sort()).toEqual([svAuthFile, svCommonFile].sort())
    expect(result.created.map(f => f.namespace).sort()).toEqual(['auth', 'common'])
  })

  it('reports per-file skipped entries when locale directory already exists', async () => {
    const config = createLaravelConfig(laravelLocales)

    const result = await scaffoldLocale(config, { locales: ['de'] })

    expect(result.created).toEqual([])
    expect(result.skipped.length).toBe(2)
    expect(result.skipped.map(f => f.namespace).sort()).toEqual(['auth', 'common'])
    expect(result.skipped.every(f => f.locale === 'de')).toBe(true)
    expect(result.skipped.every(f => f.keys > 0)).toBe(true)
  })

  it('skips individual files that exist and creates missing ones', async () => {
    const svLocale: LocaleDefinition = { code: 'sv', language: 'sv-SE' }
    const config = createLaravelConfig([...laravelLocales, svLocale])

    // Create sv directory with only auth.php
    const svDir = join(tmpLangDir, 'sv')
    await mkdir(svDir, { recursive: true })
    await writeFile(join(svDir, 'auth.php'), `<?php\n\nreturn [\n    "failed" => "",\n];\n`)

    const result = await scaffoldLocale(config, { locales: ['sv'] })

    expect(result.created.length).toBe(1)
    expect(result.created[0].namespace).toBe('common')
    expect(result.skipped.length).toBe(1)
    expect(result.skipped[0].namespace).toBe('auth')
  })
})
