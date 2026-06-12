import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VueAdapter } from '../../src/adapters/vue/index'
import { registerAdapter, resetRegistry, detectFramework } from '../../src/adapters/registry'
import { NuxtAdapter } from '../../src/adapters/nuxt/index'

function createVueProject(root: string, opts: {
  locales?: string[]
  localeDir?: string
  hasVueI18n?: boolean
  hasNuxt?: boolean
  i18nConfigFile?: string | null
  i18nConfigContent?: string
} = {}) {
  const {
    locales = ['en', 'de'],
    localeDir = 'src/locales',
    hasVueI18n = true,
    hasNuxt = false,
    i18nConfigFile = null,
    i18nConfigContent = '',
  } = opts

  const deps: Record<string, string> = { vue: '^3.4.0' }
  if (hasVueI18n) deps['vue-i18n'] = '^10.0.0'
  if (hasNuxt) deps['@nuxt/kit'] = '^3.0.0'

  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }, null, 2))

  const fullLocaleDir = join(root, localeDir)
  mkdirSync(fullLocaleDir, { recursive: true })

  for (const locale of locales) {
    writeFileSync(join(fullLocaleDir, `${locale}.json`), JSON.stringify({ hello: 'world' }))
  }

  if (i18nConfigFile) {
    const configDir = i18nConfigFile.replace(/\/[^/]+$/, '')
    if (configDir !== i18nConfigFile) {
      mkdirSync(join(root, configDir), { recursive: true })
    }
    writeFileSync(join(root, i18nConfigFile), i18nConfigContent)
  }
}

describe('VueAdapter.detect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `vue-adapter-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('has correct static properties', () => {
    const adapter = new VueAdapter()
    expect(adapter.name).toBe('vue')
    expect(adapter.label).toBe('Vue')
    expect(adapter.localeFileFormat).toBe('json')
  })

  it('returns 7 for a full Vue + vue-i18n project with locales', async () => {
    createVueProject(tempDir)
    const adapter = new VueAdapter()
    // vue (2) + vue-i18n (3) + locale files (2) = 7
    expect(await adapter.detect(tempDir)).toBe(7)
  })

  it('returns 5 for vue-i18n project without discovered locale files', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0' },
    }))
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(5)
  })

  it('returns 4 for Vue + locale files but no vue-i18n dep', async () => {
    createVueProject(tempDir, { hasVueI18n: false })
    const adapter = new VueAdapter()
    // vue (2) + locale files (2) = 4
    expect(await adapter.detect(tempDir)).toBe(4)
  })

  it('returns 2 for Vue project without vue-i18n or locale files', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0' },
    }))
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(2)
  })

  it('returns 0 when vue is not in dependencies', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
    }))
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when package.json is missing', async () => {
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when package.json is malformed', async () => {
    writeFileSync(join(tempDir, 'package.json'), '{ invalid json }')
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 for Nuxt project (vue but also @nuxt/kit)', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0', '@nuxt/kit': '^3.0.0' },
    }))
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when nuxt.config.ts exists', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0' },
    }))
    writeFileSync(join(tempDir, 'nuxt.config.ts'), 'export default {}')
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 for Nuxt project with "nuxt" in deps', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', nuxt: '^3.0.0' },
    }))
    const adapter = new VueAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })
})

describe('VueAdapter.resolve', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `vue-resolve-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves a standard vue-i18n project with src/locales/', async () => {
    createVueProject(tempDir)

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.rootDir).toBe(tempDir)
    expect(config.defaultLocale).toBe('de')
    expect(config.fallbackLocale).toEqual({ default: ['de'] })
    expect(config.locales).toHaveLength(2)
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
    expect(config.locales[0].file).toBe('de.json')
    expect(config.localeDirs).toHaveLength(1)
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'src/locales'))
    expect(config.localeDirs[0].layer).toBe('root')
    expect(config.localeDirs[0].layerRootDir).toBe(tempDir)
    expect(config.layerRootDirs).toEqual([tempDir])
  })

  it('discovers locales from locates/ directory', async () => {
    createVueProject(tempDir, { localeDir: 'locales', locales: ['en', 'fr', 'ja'] })

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales).toHaveLength(3)
    expect(config.locales.map(l => l.code)).toEqual(['en', 'fr', 'ja'])
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'locales'))
  })

  it('discovers locales from src/i18n/locales/', async () => {
    createVueProject(tempDir, { localeDir: 'src/i18n/locales', locales: ['en'] })

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.localeDirs[0].path).toBe(join(tempDir, 'src/i18n/locales'))
  })

  it('detects locale dir from createI18n config with localeDir', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0' },
    }))

    const customDir = join(tempDir, 'my-locales')
    mkdirSync(customDir, { recursive: true })
    writeFileSync(join(customDir, 'en.json'), JSON.stringify({ hello: 'world' }))

    const configFile = 'src/i18n/index.ts'
    mkdirSync(join(tempDir, 'src/i18n'), { recursive: true })
    writeFileSync(join(tempDir, configFile), `const i18n = createI18n({ localeDir: 'my-locales', legacy: false })`)

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.localeDirs[0].path).toBe(customDir)
  })

  it('defaults to first locale when no .env found', async () => {
    createVueProject(tempDir, { locales: ['en', 'de', 'fr'] })

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.defaultLocale).toBe('de')
  })

  it('throws ConfigError when no locale directory found', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0' },
    }))

    const adapter = new VueAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No locale directory found')
  })

  it('throws ConfigError when locale dir has no JSON files', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { vue: '^3.4.0', 'vue-i18n': '^10.0.0' },
    }))
    mkdirSync(join(tempDir, 'src/locales'), { recursive: true })

    const adapter = new VueAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No JSON locale files found')
  })

  it('honors locales override from .i18n-mcp.json', async () => {
    createVueProject(tempDir, { locales: ['en', 'de', 'fr', 'es'] })
    writeFileSync(
      join(tempDir, '.i18n-mcp.json'),
      JSON.stringify({ locales: ['en', 'de'] }),
    )

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['en', 'de'])
  })

  it('sorts locale codes alphabetically', async () => {
    createVueProject(tempDir, { locales: ['fr', 'en', 'de', 'zh'] })

    const adapter = new VueAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en', 'fr', 'zh'])
  })
})

describe('Adapter registry: Vue vs Nuxt', () => {
  beforeEach(() => {
    resetRegistry()
  })

  afterEach(() => {
    resetRegistry()
  })

  it('selects VueAdapter when vue-i18n signals present without Nuxt', async () => {
    const tempDir = join(tmpdir(), `registry-vue-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    createVueProject(tempDir)

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new VueAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('vue')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('selects NuxtAdapter when Nuxt config is present', async () => {
    const tempDir = join(tmpdir(), `registry-nuxt-wins-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(
      join(tempDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ i18n: { defaultLocale: "en" } })',
    )

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new VueAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('nuxt')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
