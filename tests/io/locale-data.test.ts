import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLocaleEntries, readLocaleData, mutateLocaleData } from '../../src/io/locale-data.js'
import { clearFileCache } from '../../src/io/json-reader.js'
import { clearPhpFileCache } from '../../src/io/php-reader.js'
import type { I18nConfig, LocaleDefinition } from '../../src/config/types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'locale-data-test-'))
  clearFileCache()
  clearPhpFileCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeNuxtConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
  return {
    rootDir: tempDir,
    defaultLocale: 'en',
    fallbackLocale: { default: ['en'] },
    locales: [
      { code: 'en', language: 'en', file: 'en.json' },
      { code: 'de', language: 'de', file: 'de.json' },
    ],
    localeDirs: [{ path: join(tempDir, 'locales'), layer: 'root', layerRootDir: tempDir }],
    layerRootDirs: [tempDir],
    localeFileFormat: 'json',
    ...overrides,
  }
}

function makeLaravelConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
  return {
    rootDir: tempDir,
    defaultLocale: 'en',
    fallbackLocale: { default: ['en'] },
    locales: [
      { code: 'en', language: 'en' },
      { code: 'de', language: 'de' },
    ],
    localeDirs: [{ path: join(tempDir, 'lang'), layer: 'root', layerRootDir: tempDir }],
    layerRootDirs: [tempDir],
    localeFileFormat: 'php-array',
    ...overrides,
  }
}

async function setupNuxtLocales() {
  const localesDir = join(tempDir, 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(localesDir, 'en.json'), JSON.stringify({
    common: { save: 'Save', cancel: 'Cancel' },
    auth: { login: 'Login' },
  }))
  await writeFile(join(localesDir, 'de.json'), JSON.stringify({
    common: { save: 'Speichern', cancel: 'Abbrechen' },
    auth: { login: 'Anmelden' },
  }))
}

async function setupLaravelLocales() {
  const enDir = join(tempDir, 'lang', 'en')
  const deDir = join(tempDir, 'lang', 'de')
  await mkdir(enDir, { recursive: true })
  await mkdir(deDir, { recursive: true })

  await writeFile(join(enDir, 'auth.php'), `<?php\nreturn ['failed' => 'Invalid credentials', 'throttle' => 'Too many attempts'];\n`)
  await writeFile(join(enDir, 'validation.php'), `<?php\nreturn ['required' => 'This field is required'];\n`)
  await writeFile(join(deDir, 'auth.php'), `<?php\nreturn ['failed' => 'Ungueltige Anmeldedaten'];\n`)
}

describe('resolveLocaleEntries', () => {
  it('returns single entry for Nuxt JSON locale', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const entries = await resolveLocaleEntries(config, 'root', locale)

    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(join(tempDir, 'locales', 'en.json'))
    expect(entries[0].namespace).toBeNull()
  })

  it('returns one entry per .php file for Laravel locale', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const entries = await resolveLocaleEntries(config, 'root', config.locales[0])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      path: join(tempDir, 'lang', 'en', 'auth.php'),
      namespace: 'auth',
    })
    expect(entries[1]).toEqual({
      path: join(tempDir, 'lang', 'en', 'validation.php'),
      namespace: 'validation',
    })
  })

  it('returns empty array for unknown layer', async () => {
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const entries = await resolveLocaleEntries(config, 'nonexistent', locale)
    expect(entries).toEqual([])
  })

  it('returns empty array for Nuxt locale without file field', async () => {
    const config = makeNuxtConfig({
      locales: [{ code: 'en', language: 'en' }],
    })

    const entries = await resolveLocaleEntries(config, 'root', config.locales[0])
    expect(entries).toEqual([])
  })

  it('returns empty array when Laravel locale dir does not exist', async () => {
    const config = makeLaravelConfig()

    const entries = await resolveLocaleEntries(config, 'root', config.locales[0])
    expect(entries).toEqual([])
  })

  it('follows layer aliases', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig({
      localeDirs: [
        { path: join(tempDir, 'locales'), layer: 'root', layerRootDir: tempDir },
        { path: join(tempDir, 'alias-dir'), layer: 'app-shop', layerRootDir: tempDir, aliasOf: 'root' },
      ],
    })

    const entries = await resolveLocaleEntries(config, 'app-shop', config.locales[0])

    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(join(tempDir, 'locales', 'en.json'))
  })
})

describe('readLocaleData', () => {
  it('reads Nuxt JSON locale as flat object', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()

    const data = await readLocaleData(config, 'root', config.locales[0])

    expect(data).toEqual({
      common: { save: 'Save', cancel: 'Cancel' },
      auth: { login: 'Login' },
    })
  })

  it('reads Laravel locale as namespace-keyed object', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()

    const data = await readLocaleData(config, 'root', config.locales[0])

    expect(data).toEqual({
      auth: { failed: 'Invalid credentials', throttle: 'Too many attempts' },
      validation: { required: 'This field is required' },
    })
  })

  it('reads partial Laravel locale (missing namespace files)', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()

    const data = await readLocaleData(config, 'root', config.locales[1])

    expect(data).toEqual({
      auth: { failed: 'Ungueltige Anmeldedaten' },
    })
  })

  it('returns empty object for non-existent locale dir', async () => {
    const config = makeLaravelConfig()

    const data = await readLocaleData(config, 'root', { code: 'fr', language: 'fr' })
    expect(data).toEqual({})
  })

  it('returns empty object for non-existent Nuxt file', async () => {
    await mkdir(join(tempDir, 'locales'), { recursive: true })
    const config = makeNuxtConfig()

    const data = await readLocaleData(config, 'root', { code: 'fr', language: 'fr', file: 'fr.json' })
    expect(data).toEqual({})
  })
})

describe('mutateLocaleData', () => {
  it('mutates Nuxt JSON locale and writes back', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.common as Record<string, string>).save = 'Save Changes'
      ;(data as Record<string, unknown>).newKey = 'new'
    })

    expect(written.size).toBe(1)
    expect(written.has(join(tempDir, 'locales', 'en.json'))).toBe(true)

    clearFileCache()
    const result = await readLocaleData(config, 'root', locale)
    expect((result.common as Record<string, string>).save).toBe('Save Changes')
    expect(result.newKey).toBe('new')
    expect((result.auth as Record<string, string>).login).toBe('Login')
  })

  it('mutates Laravel namespace and writes only changed namespaces', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.auth as Record<string, string>).failed = 'Bad credentials'
      ;(data.auth as Record<string, string>).newKey = 'added'
    })

    expect(written.size).toBe(1)
    expect(written.has(join(tempDir, 'lang', 'en', 'auth.php'))).toBe(true)
    expect(written.has(join(tempDir, 'lang', 'en', 'validation.php'))).toBe(false)

    clearPhpFileCache()
    const result = await readLocaleData(config, 'root', locale)
    expect((result.auth as Record<string, string>).failed).toBe('Bad credentials')
    expect((result.auth as Record<string, string>).newKey).toBe('added')
    expect((result.validation as Record<string, string>).required).toBe('This field is required')
  })

  it('creates new namespace file for Laravel', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data as Record<string, unknown>).passwords = { reset: 'Password has been reset' }
    })

    clearPhpFileCache()
    const result = await readLocaleData(config, 'root', locale)
    expect((result.passwords as Record<string, string>).reset).toBe('Password has been reset')

    const newFile = join(tempDir, 'lang', 'en', 'passwords.php')
    const content = await readFile(newFile, 'utf-8')
    expect(content).toContain('reset')
  })

  it('creates locale directory for new Laravel locale', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const frLocale: LocaleDefinition = { code: 'fr', language: 'fr' }

    await mutateLocaleData(config, 'root', frLocale, (data) => {
      ;(data as Record<string, unknown>).auth = { failed: 'Identifiants invalides' }
    })

    clearPhpFileCache()
    const updatedConfig = makeLaravelConfig({
      locales: [...config.locales, frLocale],
    })
    const result = await readLocaleData(updatedConfig, 'root', frLocale)
    expect((result.auth as Record<string, string>).failed).toBe('Identifiants invalides')
  })

  it('returns empty set when layer not found', async () => {
    const config = makeNuxtConfig()
    const written = await mutateLocaleData(config, 'nonexistent', config.locales[0], () => {})
    expect(written.size).toBe(0)
  })

  it('removes orphaned PHP files when namespace is deleted', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const locale = config.locales[0]

    clearPhpFileCache()
    const before = await readLocaleData(config, 'root', locale)
    expect(before.auth).toBeDefined()
    expect(before.validation).toBeDefined()

    await mutateLocaleData(config, 'root', locale, (data) => {
      delete data.validation
    })

    clearPhpFileCache()
    const after = await readLocaleData(config, 'root', locale)
    expect(after.auth).toBeDefined()
    expect(after.validation).toBeUndefined()

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(tempDir, 'lang', 'en', 'auth.php'))).toBe(true)
    expect(existsSync(join(tempDir, 'lang', 'en', 'validation.php'))).toBe(false)
  })

  it('returns empty set when no namespace changed', async () => {
    await setupLaravelLocales()
    const config = makeLaravelConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, () => {})
    expect(written.size).toBe(0)
  })

  it('writes only 2 of 3 namespaces when 2 changed', async () => {
    const langDir = join(tempDir, 'lang', 'en')
    await mkdir(langDir, { recursive: true })
    await writeFile(join(langDir, 'auth.php'), `<?php\nreturn ['failed' => 'Invalid credentials'];\n`)
    await writeFile(join(langDir, 'validation.php'), `<?php\nreturn ['required' => 'Required'];\n`)
    await writeFile(join(langDir, 'passwords.php'), `<?php\nreturn ['reset' => 'Reset'];\n`)

    const config = makeLaravelConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.auth as Record<string, string>).failed = 'Bad creds'
      ;(data.passwords as Record<string, string>).reset = 'Password reset'
    })

    expect(written.size).toBe(2)
    expect(written.has(join(tempDir, 'lang', 'en', 'auth.php'))).toBe(true)
    expect(written.has(join(tempDir, 'lang', 'en', 'passwords.php'))).toBe(true)
    expect(written.has(join(tempDir, 'lang', 'en', 'validation.php'))).toBe(false)
  })

  it('JSON write path is unaffected by per-namespace changes', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.common as Record<string, string>).save = 'Save Changes'
    })

    expect(written.size).toBe(1)
    expect(written.has(join(tempDir, 'locales', 'en.json'))).toBe(true)
  })

  it('JSON write path returns empty set on no-op mutation', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, () => {})
    expect(written.size).toBe(0)
  })
})
