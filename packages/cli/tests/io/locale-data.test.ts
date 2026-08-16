import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLocaleEntries, readLocaleData, mutateLocaleData } from '../../src/io/locale-data.js'
import { clearFileCache } from '../../src/io/json-reader.js'
import { clearPhpFileCache } from '../../src/io/php-reader.js'
import { log } from '../../src/utils/logger.js'
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

function makeNextJsConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
  return {
    rootDir: tempDir,
    defaultLocale: 'en',
    fallbackLocale: { default: ['en'] },
    locales: [
      { code: 'en', language: 'en' },
      { code: 'de', language: 'de' },
    ],
    localeDirs: [{ path: join(tempDir, 'messages'), layer: 'root', layerRootDir: tempDir }],
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

async function setupNextJsLocales() {
  const enDir = join(tempDir, 'messages', 'en')
  const deDir = join(tempDir, 'messages', 'de')
  await mkdir(enDir, { recursive: true })
  await mkdir(deDir, { recursive: true })

  await writeFile(join(enDir, 'common.json'), JSON.stringify({ save: 'Save', cancel: 'Cancel' }))
  await writeFile(join(enDir, 'auth.json'), JSON.stringify({ login: 'Login', logout: 'Logout' }))
  await writeFile(join(deDir, 'common.json'), JSON.stringify({ save: 'Speichern', cancel: 'Abbrechen' }))
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

  it('returns one entry per .json file for Next.js namespaced JSON', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const entries = await resolveLocaleEntries(config, 'root', config.locales[0])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      path: join(tempDir, 'messages', 'en', 'auth.json'),
      namespace: 'auth',
    })
    expect(entries[1]).toEqual({
      path: join(tempDir, 'messages', 'en', 'common.json'),
      namespace: 'common',
    })
  })

  it('falls back to flat JSON when no namespaced subdirectory exists', async () => {
    await setupNuxtLocales()
    const config = makeNuxtConfig()
    const locale = config.locales[0]

    const entries = await resolveLocaleEntries(config, 'root', locale)

    expect(entries).toHaveLength(1)
    expect(entries[0].namespace).toBeNull()
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

  it('reads Next.js namespaced JSON as namespace-keyed object', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()

    const data = await readLocaleData(config, 'root', config.locales[0])

    expect(data).toEqual({
      auth: { login: 'Login', logout: 'Logout' },
      common: { save: 'Save', cancel: 'Cancel' },
    })
  })

  it('reads partial Next.js locale (missing namespace files)', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()

    const data = await readLocaleData(config, 'root', config.locales[1])

    expect(data).toEqual({
      common: { save: 'Speichern', cancel: 'Abbrechen' },
    })
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

  it('mutates Next.js namespace and writes only changed files', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]

    const written = await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.auth as Record<string, string>).login = 'Sign In'
    })

    expect(written.size).toBe(1)
    expect(written.has(join(tempDir, 'messages', 'en', 'auth.json'))).toBe(true)
    expect(written.has(join(tempDir, 'messages', 'en', 'common.json'))).toBe(false)

    clearFileCache()
    const result = await readLocaleData(config, 'root', locale)
    expect((result.auth as Record<string, string>).login).toBe('Sign In')
    expect((result.common as Record<string, string>).save).toBe('Save')
  })

  it('creates new namespace file for Next.js', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data as Record<string, unknown>).profile = { title: 'My Profile' }
    })

    clearFileCache()
    const result = await readLocaleData(config, 'root', locale)
    expect((result.profile as Record<string, string>).title).toBe('My Profile')

    const content = await readFile(join(tempDir, 'messages', 'en', 'profile.json'), 'utf-8')
    expect(JSON.parse(content)).toEqual({ title: 'My Profile' })
  })

  it('removes orphaned JSON files when namespace is deleted', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      delete data.auth
    })

    clearFileCache()
    const after = await readLocaleData(config, 'root', locale)
    expect(after.auth).toBeUndefined()
    expect(after.common).toBeDefined()

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(tempDir, 'messages', 'en', 'auth.json'))).toBe(false)
    expect(existsSync(join(tempDir, 'messages', 'en', 'common.json'))).toBe(true)
  })

  it('logs a warning naming each namespace file it deletes', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})

    try {
      await mutateLocaleData(config, 'root', locale, (data) => {
        delete data.auth
      })

      const messages = warnSpy.mock.calls.map(args => args.join(' '))
      expect(messages.some(m => m.includes(join(tempDir, 'messages', 'en', 'auth.json')) && m.includes("'auth'"))).toBe(true)
    }
    finally {
      warnSpy.mockRestore()
    }
  })

  it('does not delete namespace files it did not explicitly remove', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]
    const strayFile = join(tempDir, 'messages', 'en', 'stray.json')

    await mutateLocaleData(config, 'root', locale, (data) => {
      // Simulate a concurrent writer creating a namespace file after this
      // mutation read the directory: it must survive the write-back.
      writeFileSync(strayFile, JSON.stringify({ other: 'data' }))
      ;(data.auth as Record<string, string>).login = 'Sign In'
    })

    const { existsSync } = await import('node:fs')
    expect(existsSync(strayFile)).toBe(true)
    expect(JSON.parse(await readFile(strayFile, 'utf-8'))).toEqual({ other: 'data' })
  })

  it('preserves 2-space indentation and existing key order on namespaced JSON writes', async () => {
    const enDir = join(tempDir, 'messages', 'en')
    await mkdir(enDir, { recursive: true })
    await writeFile(join(enDir, 'common.json'), '{\n  "zebra": "z",\n  "apple": "a",\n  "mango": "m"\n}\n')

    const config = makeNextJsConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.common as Record<string, string>).banana = 'b'
    })

    const content = await readFile(join(enDir, 'common.json'), 'utf-8')
    expect(content).not.toContain('\t')
    expect(content).toContain('  "zebra"')
    expect(Object.keys(JSON.parse(content))).toEqual(['zebra', 'apple', 'banana', 'mango'])
    expect(content.endsWith('\n')).toBe(true)
  })

  it('preserves indentation and key order on flat JSON writes', async () => {
    const localesDir = join(tempDir, 'locales')
    await mkdir(localesDir, { recursive: true })
    await writeFile(join(localesDir, 'en.json'), '{\n  "zebra": "z",\n  "apple": "a"\n}\n')

    const config = makeNuxtConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data as Record<string, unknown>).mango = 'm'
    })

    const content = await readFile(join(localesDir, 'en.json'), 'utf-8')
    expect(content).not.toContain('\t')
    expect(content).toContain('  "zebra"')
    expect(Object.keys(JSON.parse(content))).toEqual(['zebra', 'apple', 'mango'])
  })

  it('preserves PHP quote style and key order on namespaced PHP writes', async () => {
    const enDir = join(tempDir, 'lang', 'en')
    await mkdir(enDir, { recursive: true })
    await writeFile(join(enDir, 'auth.php'), `<?php\n\nreturn [\n  'zebra' => 'z',\n  'apple' => 'a',\n];\n`)

    const config = makeLaravelConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data.auth as Record<string, string>).mango = 'm'
    })

    const content = await readFile(join(enDir, 'auth.php'), 'utf-8')
    expect(content).toContain("  'zebra' => 'z',")
    const order = ['zebra', 'apple', 'mango'].map(k => content.indexOf(`'${k}'`))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('writes new namespace files with sorted keys and default formatting', async () => {
    await setupNextJsLocales()
    const config = makeNextJsConfig()
    const locale = config.locales[0]

    await mutateLocaleData(config, 'root', locale, (data) => {
      ;(data as Record<string, unknown>).profile = { title: 'My Profile', avatar: 'Avatar' }
    })

    const content = await readFile(join(tempDir, 'messages', 'en', 'profile.json'), 'utf-8')
    expect(Object.keys(JSON.parse(content))).toEqual(['avatar', 'title'])
    expect(content).toContain('\t"avatar"')
  })
})

describe('resolveLocaleEntries flat-layout misconfiguration', () => {
  it('warns loudly when a flat JSON file exists but the locale has no file set', async () => {
    const localesDir = join(tempDir, 'locales')
    await mkdir(localesDir, { recursive: true })
    await writeFile(join(localesDir, 'en.json'), JSON.stringify({ hello: 'world' }))

    const config = makeNuxtConfig({
      locales: [{ code: 'en', language: 'en' }], // no `file`
    })
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})

    try {
      const entries = await resolveLocaleEntries(config, 'root', config.locales[0])
      expect(entries).toEqual([])

      const messages = warnSpy.mock.calls.map(args => args.join(' '))
      expect(messages.some(m => m.includes("'en'") && m.includes("'root'") && m.includes('file'))).toBe(true)
    }
    finally {
      warnSpy.mockRestore()
    }
  })

  it('stays silent when neither a file nor a flat candidate exists (new locale)', async () => {
    await mkdir(join(tempDir, 'locales'), { recursive: true })
    const config = makeNuxtConfig({
      locales: [{ code: 'fr', language: 'fr' }],
    })
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})

    try {
      const entries = await resolveLocaleEntries(config, 'root', config.locales[0])
      expect(entries).toEqual([])
      expect(warnSpy).not.toHaveBeenCalled()
    }
    finally {
      warnSpy.mockRestore()
    }
  })
})

describe('flat PHP locale files (#308)', () => {
  /**
   * `php-array` meant Laravel's lang/<locale>/<namespace>.php, always. A flat
   * lang/<locale>.php could not be resolved, and the write path would have
   * restructured it into directories rather than editing it. What is on disk
   * decides now; the format is only the fallback when there is nothing there
   * yet to observe.
   */
  function makeFlatPhpConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
    return {
      rootDir: tempDir,
      defaultLocale: 'en',
      fallbackLocale: { default: ['en'] },
      locales: [
        { code: 'en', language: 'en', file: 'en.php' },
        { code: 'de', language: 'de', file: 'de.php' },
      ],
      localeDirs: [{ path: join(tempDir, 'lang'), layer: 'default', layerRootDir: tempDir }],
      layerRootDirs: [tempDir],
      localeFileFormat: 'php-array',
      apps: [{ name: 'default', rootDir: tempDir, layers: ['default'] }],
      ...overrides,
    }
  }

  const de: LocaleDefinition = { code: 'de', language: 'de', file: 'de.php' }

  beforeEach(async () => {
    await mkdir(join(tempDir, 'lang'), { recursive: true })
    await writeFile(join(tempDir, 'lang', 'de.php'), '<?php\nreturn [\n  "save" => "Speichern",\n];\n')
  })

  it('resolves the flat file', async () => {
    const entries = await resolveLocaleEntries(makeFlatPhpConfig(), 'default', de)

    expect(entries).toEqual([{ path: join(tempDir, 'lang', 'de.php'), namespace: null }])
  })

  it('reads its keys unnamespaced', async () => {
    const data = await readLocaleData(makeFlatPhpConfig(), 'default', de)

    expect(data).toEqual({ save: 'Speichern' })
  })

  it('writes back into the same file instead of creating a directory', async () => {
    const written = await mutateLocaleData(makeFlatPhpConfig(), 'default', de, (data) => {
      data.cancel = 'Abbrechen'
    })

    expect([...written]).toEqual([join(tempDir, 'lang', 'de.php')])

    const onDisk = await readFile(join(tempDir, 'lang', 'de.php'), 'utf-8')
    expect(onDisk).toContain('"cancel" => "Abbrechen"')
    expect(onDisk).toContain('"save" => "Speichern"')
  })

  // The Laravel layout must keep working: entries carry a namespace, so the
  // namespaced write path still applies.
  it('still treats a namespaced PHP layout as namespaced', async () => {
    await mkdir(join(tempDir, 'lang', 'de'), { recursive: true })
    await writeFile(join(tempDir, 'lang', 'de', 'auth.php'), '<?php\nreturn [\n  "failed" => "Fehlgeschlagen",\n];\n')

    const config = makeFlatPhpConfig({
      locales: [{ code: 'de', language: 'de' }],
    })
    const entries = await resolveLocaleEntries(config, 'default', { code: 'de', language: 'de' })

    expect(entries.map(e => e.namespace)).toEqual(['auth'])
  })
})
