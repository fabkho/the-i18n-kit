import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LaravelAdapter } from '../../src/adapters/laravel/index'
import { registerAdapter, resetRegistry, detectFramework } from '../../src/adapters/registry'
import { NuxtAdapter } from '../../src/adapters/nuxt/index'

function createLaravelProject(root: string, opts: {
  artisan?: boolean
  composer?: Record<string, unknown> | null
  locales?: string[]
  langDir?: 'modern' | 'legacy'
  configAppPhp?: string | null
} = {}) {
  const {
    artisan = true,
    composer = { require: { 'laravel/framework': '^11.0' } },
    locales = ['en'],
    langDir = 'modern',
    configAppPhp = `<?php\nreturn [\n    'locale' => 'en',\n    'fallback_locale' => 'en',\n];\n`,
  } = opts

  if (artisan) {
    writeFileSync(join(root, 'artisan'), '#!/usr/bin/env php\n<?php\n')
  }

  if (composer) {
    writeFileSync(join(root, 'composer.json'), JSON.stringify(composer, null, 2))
  }

  const langBase = langDir === 'modern'
    ? join(root, 'lang')
    : join(root, 'resources', 'lang')

  mkdirSync(langBase, { recursive: true })

  for (const locale of locales) {
    const localeDir = join(langBase, locale)
    mkdirSync(localeDir, { recursive: true })
    writeFileSync(
      join(localeDir, 'auth.php'),
      `<?php\nreturn [\n    'failed' => 'These credentials do not match.',\n];\n`,
    )
  }

  if (configAppPhp) {
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(join(root, 'config', 'app.php'), configAppPhp)
  }
}

describe('LaravelAdapter.detect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `laravel-adapter-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('has correct static properties', () => {
    const adapter = new LaravelAdapter()
    expect(adapter.name).toBe('laravel')
    expect(adapter.label).toBe('Laravel')
    expect(adapter.localeFileFormat).toBe('php-array')
  })

  it('returns 2 when artisan file exists', async () => {
    writeFileSync(join(tempDir, 'artisan'), '#!/usr/bin/env php')
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(2)
  })

  it('returns 2 when composer.json has laravel/framework', async () => {
    writeFileSync(join(tempDir, 'composer.json'), JSON.stringify({
      require: { 'laravel/framework': '^11.0' },
    }))
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(2)
  })

  it('returns 1 when lang/ has locale subdirectories with .php files', async () => {
    const enDir = join(tempDir, 'lang', 'en')
    mkdirSync(enDir, { recursive: true })
    writeFileSync(join(enDir, 'auth.php'), '<?php return [];')
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(1)
  })

  it('returns 0 for an empty directory', async () => {
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when lang/ exists but has no .php files in subdirs', async () => {
    const enDir = join(tempDir, 'lang', 'en')
    mkdirSync(enDir, { recursive: true })
    writeFileSync(join(enDir, 'readme.txt'), 'not a php file')
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when lang/ has only a vendor directory', async () => {
    mkdirSync(join(tempDir, 'lang', 'vendor', 'some-package'), { recursive: true })
    writeFileSync(join(tempDir, 'lang', 'vendor', 'some-package', 'en.php'), '<?php return [];')
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when composer.json exists without laravel/framework', async () => {
    writeFileSync(join(tempDir, 'composer.json'), JSON.stringify({
      require: { 'symfony/console': '^6.0' },
    }))
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when composer.json is malformed', async () => {
    writeFileSync(join(tempDir, 'composer.json'), '{ invalid json }')
    const adapter = new LaravelAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('accumulates confidence from multiple signals', async () => {
    createLaravelProject(tempDir, {
      artisan: true,
      composer: { require: { 'laravel/framework': '^11.0' } },
      locales: ['en'],
    })
    const adapter = new LaravelAdapter()
    // artisan (2) + composer (2) + lang/ with .php (1) = 5
    expect(await adapter.detect(tempDir)).toBe(5)
  })

  it('accumulates artisan + lang/ without composer', async () => {
    createLaravelProject(tempDir, {
      artisan: true,
      composer: null,
      locales: ['en'],
    })
    const adapter = new LaravelAdapter()
    // artisan (2) + lang/ with .php (1) = 3
    expect(await adapter.detect(tempDir)).toBe(3)
  })
})

describe('LaravelAdapter.resolve', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `laravel-resolve-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves a standard Laravel 9+ project with lang/ at root', async () => {
    createLaravelProject(tempDir, {
      locales: ['en', 'de', 'fr'],
      configAppPhp: `<?php\nreturn [\n    'locale' => 'de',\n    'fallback_locale' => 'en',\n];\n`,
    })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.rootDir).toBe(tempDir)
    expect(config.defaultLocale).toBe('de')
    expect(config.fallbackLocale).toEqual({ default: ['en'] })
    expect(config.locales).toHaveLength(3)
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en', 'fr'])
    expect(config.locales[0].language).toBe('de')
    expect(config.locales[0].file).toBeUndefined()
    expect(config.localeDirs).toHaveLength(1)
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'lang'))
    expect(config.localeDirs[0].layer).toBe('root')
    expect(config.localeDirs[0].layerRootDir).toBe(tempDir)
    expect(config.layerRootDirs).toEqual([tempDir])
    expect(config.localeFileFormat).toBe('php-array')
  })

  it('resolves a legacy Laravel project with resources/lang/', async () => {
    createLaravelProject(tempDir, {
      locales: ['en', 'es'],
      langDir: 'legacy',
    })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales).toHaveLength(2)
    expect(config.locales.map(l => l.code)).toEqual(['en', 'es'])
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'resources', 'lang'))
  })

  it('extracts locale from env() pattern in config/app.php', async () => {
    createLaravelProject(tempDir, {
      configAppPhp: `<?php\nreturn [\n    'locale' => env('APP_LOCALE', 'fr'),\n    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),\n];\n`,
    })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.defaultLocale).toBe('fr')
    expect(config.fallbackLocale).toEqual({ default: ['en'] })
  })

  it('defaults to "en" when config/app.php is missing', async () => {
    createLaravelProject(tempDir, { configAppPhp: null })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.defaultLocale).toBe('en')
    expect(config.fallbackLocale).toEqual({ default: ['en'] })
  })

  it('ignores vendor/ directory in lang/', async () => {
    createLaravelProject(tempDir, { locales: ['en'] })
    mkdirSync(join(tempDir, 'lang', 'vendor', 'notifications', 'en'), { recursive: true })
    writeFileSync(
      join(tempDir, 'lang', 'vendor', 'notifications', 'en', 'messages.php'),
      '<?php return [];',
    )

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales).toHaveLength(1)
    expect(config.locales[0].code).toBe('en')
  })

  it('throws ConfigError when no lang directory exists', async () => {
    writeFileSync(join(tempDir, 'artisan'), '#!/usr/bin/env php')

    const adapter = new LaravelAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No lang/ or resources/lang/')
  })

  it('throws ConfigError when lang/ has no locale subdirectories', async () => {
    mkdirSync(join(tempDir, 'lang'))

    const adapter = new LaravelAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No locale subdirectories')
  })

  it('skips locale subdirectories that contain no .php files', async () => {
    createLaravelProject(tempDir, { locales: ['en'] })
    mkdirSync(join(tempDir, 'lang', 'empty-locale'), { recursive: true })
    writeFileSync(join(tempDir, 'lang', 'empty-locale', 'readme.txt'), 'no php here')

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['en'])
  })

  it('sorts locale codes alphabetically', async () => {
    createLaravelProject(tempDir, { locales: ['fr', 'en', 'de', 'zh'] })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en', 'fr', 'zh'])
  })

  it('includes locales from config/app.php that have no directory on disk', async () => {
    createLaravelProject(tempDir, {
      locales: ['en', 'de'],
      configAppPhp: `<?php\nreturn [\n    'locale' => 'de',\n    'fallback_locale' => 'en',\n    'locales' => ['de', 'en', 'sv', 'el'],\n];\n`,
    })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'el', 'en', 'sv'])
  })

  it('does not duplicate locales that exist on both disk and config', async () => {
    createLaravelProject(tempDir, {
      locales: ['en', 'de'],
      configAppPhp: `<?php\nreturn [\n    'locale' => 'de',\n    'fallback_locale' => 'en',\n    'locales' => ['de', 'en'],\n];\n`,
    })

    const adapter = new LaravelAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
  })
})

describe('Adapter registry: Laravel vs Nuxt', () => {
  beforeEach(() => {
    resetRegistry()
  })

  afterEach(() => {
    resetRegistry()
  })

  it('selects LaravelAdapter when Laravel signals are stronger', async () => {
    const tempDir = join(tmpdir(), `registry-laravel-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    createLaravelProject(tempDir)

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new LaravelAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('laravel')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('selects NuxtAdapter when Nuxt signals are stronger', async () => {
    const tempDir = join(tmpdir(), `registry-nuxt-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(
      join(tempDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ i18n: { defaultLocale: "en" } })',
    )

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new LaravelAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('nuxt')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('respects framework hint from project config', async () => {
    registerAdapter(new NuxtAdapter())
    registerAdapter(new LaravelAdapter())

    const adapter = await detectFramework('/any/dir', 'laravel')
    expect(adapter.name).toBe('laravel')
  })
})
