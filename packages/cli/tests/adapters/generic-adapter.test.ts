import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GenericAdapter } from '../../src/adapters/generic/index'
import { registerAdapter, resetRegistry, detectFramework } from '../../src/adapters/registry'
import { NuxtAdapter } from '../../src/adapters/nuxt/index'
import { LaravelAdapter } from '../../src/adapters/laravel/index'
import { loadProjectConfig } from '../../src/config/project-config'

function createGenericProject(root: string, opts: {
  localeDirs?: Array<string | { path: string; layer: string }>
  defaultLocale?: string
  locales?: string[]
  framework?: string
  structure?: 'flat-json' | 'dir-json' | 'dir-php'
  localeNames?: string[]
} = {}) {
  const {
    localeDirs = ['locales'],
    defaultLocale = 'en',
    locales,
    framework,
    structure = 'flat-json',
    localeNames = ['en', 'de'],
  } = opts

  const config: Record<string, unknown> = { localeDirs, defaultLocale }
  if (locales) config.locales = locales
  if (framework) config.framework = framework

  writeFileSync(join(root, '.i18n-mcp.json'), JSON.stringify(config, null, 2))

  for (const entry of localeDirs) {
    const dirPath = typeof entry === 'string' ? entry : entry.path
    const absDir = join(root, dirPath)
    mkdirSync(absDir, { recursive: true })

    for (const locale of localeNames) {
      if (structure === 'flat-json') {
        writeFileSync(join(absDir, `${locale}.json`), JSON.stringify({ hello: 'world' }))
      } else if (structure === 'dir-json') {
        mkdirSync(join(absDir, locale), { recursive: true })
        writeFileSync(join(absDir, locale, 'common.json'), JSON.stringify({ hello: 'world' }))
      } else if (structure === 'dir-php') {
        mkdirSync(join(absDir, locale), { recursive: true })
        writeFileSync(join(absDir, locale, 'messages.php'), '<?php return [];')
      }
    }
  }
}

describe('GenericAdapter.detect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `generic-adapter-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('has correct static properties', () => {
    const adapter = new GenericAdapter()
    expect(adapter.name).toBe('generic')
    expect(adapter.label).toBe('Generic')
    expect(adapter.localeFileFormat).toBe('json')
  })

  it('returns 10 when both localeDirs and defaultLocale are present', async () => {
    createGenericProject(tempDir)
    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(10)
  })

  it('returns 0 when localeDirs is missing', async () => {
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({ defaultLocale: 'en' }))
    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when defaultLocale is missing', async () => {
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({ localeDirs: ['locales'] }))
    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when no config file exists', async () => {
    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 1 for a conventional locale directory and no config at all', async () => {
    mkdirSync(join(tempDir, 'src/locales'), { recursive: true })
    writeFileSync(join(tempDir, 'src/locales/en.json'), '{}')

    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(1)
  })

  // A directory that exists and holds nothing resolvable must not claim the
  // project: resolve would then fail on a project another adapter could have
  // taken.
  it('returns 0 for a conventional directory with no locale files in it', async () => {
    mkdirSync(join(tempDir, 'src/locales'), { recursive: true })
    writeFileSync(join(tempDir, 'src/locales/README.md'), '# not a locale')

    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 for a directory outside the conventional set', async () => {
    mkdirSync(join(tempDir, 'src/translations'), { recursive: true })
    writeFileSync(join(tempDir, 'src/translations/en.json'), '{}')

    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when localeDirs is empty', async () => {
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({ localeDirs: [], defaultLocale: 'en' }))
    const adapter = new GenericAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })
})

describe('GenericAdapter.resolve', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `generic-resolve-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves flat JSON project with auto-discovered locales', async () => {
    createGenericProject(tempDir, { localeNames: ['en', 'de', 'fr'] })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.rootDir).toBe(tempDir)
    expect(config.defaultLocale).toBe('en')
    expect(config.fallbackLocale).toEqual({ default: ['en'] })
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en', 'fr'])
    expect(config.locales[0].file).toBe('de.json')
    expect(config.localeDirs).toHaveLength(1)
    expect(config.localeDirs[0].layer).toBe('default')
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'locales'))
    expect(config.localeDirs[0].layerRootDir).toBe(tempDir)
    expect(config.layerRootDirs).toEqual([tempDir])
    expect(config.localeFileFormat).toBe('json')
  })

  it('resolves directory-per-locale JSON project', async () => {
    createGenericProject(tempDir, { structure: 'dir-json', localeNames: ['en', 'de'] })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
    expect(config.localeFileFormat).toBe('json')
  })

  it('resolves directory-per-locale PHP project', async () => {
    createGenericProject(tempDir, { structure: 'dir-php', localeNames: ['en', 'de'] })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
    expect(config.localeFileFormat).toBe('php-array')
    expect(config.locales[0].file).toBeUndefined()
  })

  it('uses explicit locales from config instead of auto-discovery', async () => {
    createGenericProject(tempDir, {
      localeNames: ['en', 'de', 'fr', 'es'],
      locales: ['en', 'de'],
    })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['en', 'de'])
  })

  it('supports multiple localeDirs with explicit layer names', async () => {
    createGenericProject(tempDir, {
      localeDirs: [
        { path: 'packages/ui/locales', layer: 'ui' },
        { path: 'packages/app/locales', layer: 'app' },
      ],
      localeNames: ['en', 'de'],
    })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeDirs).toHaveLength(2)
    expect(config.localeDirs[0].layer).toBe('ui')
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'packages/ui/locales'))
    expect(config.localeDirs[1].layer).toBe('app')
  })

  it('single string localeDirs entry gets layer "default"', async () => {
    createGenericProject(tempDir, { localeDirs: ['src/locales'] })

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeDirs[0].layer).toBe('default')
  })

  it('resolves a conventional directory with nothing declared', async () => {
    mkdirSync(join(tempDir, 'src/locales'), { recursive: true })
    writeFileSync(join(tempDir, 'src/locales/en.json'), JSON.stringify({ hello: 'world' }))
    writeFileSync(join(tempDir, 'src/locales/de.json'), JSON.stringify({ hello: 'welt' }))

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeDirs.map(d => d.path)).toEqual([join(tempDir, 'src/locales')])
    expect(config.localeDirs[0].layer).toBe('default')
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
    // Nothing declares the default locale, so the first discovered code stands in.
    expect(config.defaultLocale).toBe('de')
  })

  it('prefers the declared directory over a conventional one', async () => {
    createGenericProject(tempDir, { localeDirs: ['translations'], localeNames: ['en'] })
    mkdirSync(join(tempDir, 'src/locales'), { recursive: true })
    writeFileSync(join(tempDir, 'src/locales/fr.json'), '{}')

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeDirs.map(d => d.path)).toEqual([join(tempDir, 'translations')])
  })

  it('throws when locale directory does not exist', async () => {
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({
      localeDirs: ['nonexistent'],
      defaultLocale: 'en',
    }))

    const adapter = new GenericAdapter()
    await expect(adapter.resolve(tempDir, await loadProjectConfig(tempDir))).rejects.toThrow('Locale directory does not exist')
  })

  it('throws when localeDirs is empty (e.g. via framework hint)', async () => {
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({
      localeDirs: [],
      defaultLocale: 'en',
    }))

    const adapter = new GenericAdapter()
    await expect(adapter.resolve(tempDir, await loadProjectConfig(tempDir))).rejects.toThrow('GenericAdapter requires both')
  })

  it('throws when no locale files are found', async () => {
    const localeDir = join(tempDir, 'locales')
    mkdirSync(localeDir, { recursive: true })
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({
      localeDirs: ['locales'],
      defaultLocale: 'en',
    }))

    const adapter = new GenericAdapter()
    await expect(adapter.resolve(tempDir, await loadProjectConfig(tempDir))).rejects.toThrow('No locale files found')
  })

  it('ignores non-locale files like index.json and README.md', async () => {
    createGenericProject(tempDir, { localeNames: ['en'] })
    writeFileSync(join(tempDir, 'locales', 'index.json'), '{}')
    writeFileSync(join(tempDir, 'locales', 'README.md'), '# Readme')

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['en'])
  })

  it('ignores dotfiles', async () => {
    createGenericProject(tempDir, { localeNames: ['en'] })
    writeFileSync(join(tempDir, 'locales', '.DS_Store'), '')

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['en'])
  })

  it('includes projectConfig in resolved config', async () => {
    createGenericProject(tempDir)

    const adapter = new GenericAdapter()
    const config = await adapter.resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.projectConfig).toBeDefined()
    expect(config.projectConfig!.defaultLocale).toBe('en')
    expect(config.projectConfig!.localeDirs).toEqual(['locales'])
  })
})

describe('GenericAdapter with flat PHP locale files (#308)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `generic-php-test-${Date.now()}`)
    mkdirSync(join(tempDir, 'lang'), { recursive: true })
    writeFileSync(join(tempDir, 'lang', 'en.php'), '<?php\nreturn [\n  "save" => "Save",\n];\n')
    writeFileSync(join(tempDir, 'lang', 'de.php'), '<?php\nreturn [\n  "save" => "Speichern",\n];\n')
    writeFileSync(join(tempDir, '.i18n-mcp.json'), JSON.stringify({
      localeDirs: ['lang'],
      defaultLocale: 'en',
    }))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // Detection only looked for .php inside per-locale directories, so a flat
  // layout read as an empty directory and resolve threw "No locale files found".
  it('detects the format from flat .php files', async () => {
    const config = await new GenericAdapter().resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeFileFormat).toBe('php-array')
  })

  it('discovers the locales rather than failing', async () => {
    const config = await new GenericAdapter().resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
  })

  // `file` is what tells the reader there is a single file per locale. A
  // namespaced PHP layout has none, and leaves it unset.
  it('names the flat file on each locale', async () => {
    const config = await new GenericAdapter().resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.locales.map(l => l.file)).toEqual(['de.php', 'en.php'])
  })

  it('leaves a namespaced PHP layout without a file name', async () => {
    rmSync(join(tempDir, 'lang'), { recursive: true, force: true })
    mkdirSync(join(tempDir, 'lang', 'en'), { recursive: true })
    writeFileSync(join(tempDir, 'lang', 'en', 'auth.php'), '<?php\nreturn [\n  "failed" => "Failed",\n];\n')

    const config = await new GenericAdapter().resolve(tempDir, await loadProjectConfig(tempDir))

    expect(config.localeFileFormat).toBe('php-array')
    expect(config.locales.map(l => l.file)).toEqual([undefined])
  })
})

describe('Adapter registry: Generic vs others', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `registry-generic-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    resetRegistry()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    resetRegistry()
  })

  it('selects GenericAdapter when localeDirs + defaultLocale present and no framework signals', async () => {
    createGenericProject(tempDir)

    registerAdapter(new NuxtAdapter())
    registerAdapter(new LaravelAdapter())
    registerAdapter(new GenericAdapter())

    const adapter = await detectFramework(tempDir)
    expect(adapter.name).toBe('generic')
  })

  it('selects GenericAdapter over LaravelAdapter when explicit localeDirs config is present', async () => {
    createGenericProject(tempDir)
    writeFileSync(join(tempDir, 'artisan'), '#!/usr/bin/env php')
    writeFileSync(join(tempDir, 'composer.json'), JSON.stringify({
      require: { 'laravel/framework': '^11.0' },
    }))
    const langDir = join(tempDir, 'lang', 'en')
    mkdirSync(langDir, { recursive: true })
    writeFileSync(join(langDir, 'auth.php'), '<?php return [];')

    registerAdapter(new NuxtAdapter())
    registerAdapter(new LaravelAdapter())
    registerAdapter(new GenericAdapter())

    const adapter = await detectFramework(tempDir)
    expect(adapter.name).toBe('generic')
  })

  it('respects framework hint "generic"', async () => {
    registerAdapter(new NuxtAdapter())
    registerAdapter(new LaravelAdapter())
    registerAdapter(new GenericAdapter())

    const adapter = await detectFramework('/any/dir', 'generic')
    expect(adapter.name).toBe('generic')
  })
})
