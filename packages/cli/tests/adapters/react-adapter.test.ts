import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'pathe'
import { tmpdir } from 'node:os'
import { ReactAdapter } from '../../src/adapters/react/index'
import { registerAdapter, resetRegistry, detectFramework } from '../../src/adapters/registry'
import { NuxtAdapter } from '../../src/adapters/nuxt/index'
import { VueAdapter } from '../../src/adapters/vue/index'

function createReactProject(root: string, opts: {
  type?: 'next' | 'react'
  locales?: string[]
  localeDir?: string
  i18nDep?: string | null
  hasNextConfig?: boolean
} = {}) {
  const {
    type = 'next',
    locales = ['en', 'de'],
    localeDir = 'messages',
    i18nDep = 'next-intl',
    hasNextConfig = true,
  } = opts

  const deps: Record<string, string> = {}
  if (type === 'next') {
    deps.next = '^14.0.0'
  }
  deps.react = '^18.2.0'
  deps['react-dom'] = '^18.2.0'
  if (i18nDep) deps[i18nDep] = '^3.0.0'

  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }, null, 2))

  if (type === 'next' && hasNextConfig) {
    let config = "const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')\n"
    config += 'export default withNextIntl({})\n'
    writeFileSync(join(root, 'next.config.ts'), config)
  }

  const fullLocaleDir = join(root, localeDir)
  mkdirSync(fullLocaleDir, { recursive: true })

  for (const locale of locales) {
    const localeSubdir = join(fullLocaleDir, locale)
    mkdirSync(localeSubdir, { recursive: true })
    writeFileSync(join(localeSubdir, 'common.json'), JSON.stringify({ hello: 'world' }))
  }
}

describe('ReactAdapter.detect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `react-adapter-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('has correct static properties', () => {
    const adapter = new ReactAdapter()
    expect(adapter.name).toBe('react')
    expect(adapter.label).toBe('React / Next.js')
    expect(adapter.localeFileFormat).toBe('json')
  })

  it('returns 10 for Next.js + next-intl + locale files', async () => {
    createReactProject(tempDir)
    // next (5) + i18n dep (2) + next.config (1) + locale files (2) = 10
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(10)
  })

  it('returns 9 for Next.js + next-intl without next.config', async () => {
    createReactProject(tempDir, { hasNextConfig: false })
    const adapter = new ReactAdapter()
    // next (5) + i18n dep (2) + locale files (2) = 9
    expect(await adapter.detect(tempDir)).toBe(9)
  })

  it('returns 8 for Next.js without i18n dep but with locale files', async () => {
    createReactProject(tempDir, { i18nDep: null })
    // next (5) + next.config (1) + locale files (2) = 8... wait
    // Actually without i18n dep: next (5) + hasNextConfig (1) + locale files (2) = 8
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(8)
  })

  it('returns 5 for React + react-i18next + locale files', async () => {
    createReactProject(tempDir, { type: 'react', i18nDep: 'react-i18next', hasNextConfig: false })
    // react (3) + i18n dep (2) + locale files (2) = 7
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(7)
  })

  it('returns 3 for bare React without i18n or locale files', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
    }))
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(3)
  })

  it('returns 0 when neither React nor Next.js deps present', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
    }))
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 when package.json is missing', async () => {
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 for Vue project (react deps present but vue first)', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0', vue: '^3.0.0' },
    }))
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })

  it('returns 0 for Nuxt project', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0', '@nuxt/kit': '^3.0.0' },
    }))
    const adapter = new ReactAdapter()
    expect(await adapter.detect(tempDir)).toBe(0)
  })
})

describe('ReactAdapter.resolve', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `react-resolve-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves standard Next.js + next-intl project', async () => {
    createReactProject(tempDir)

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.rootDir).toBe(tempDir)
    expect(config.defaultLocale).toBe('de')
    expect(config.fallbackLocale).toEqual({ default: ['de'] })
    expect(config.locales).toHaveLength(2)
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
    expect(config.localeDirs).toHaveLength(1)
    expect(config.localeDirs[0].path).toBe(join(tempDir, 'messages'))
    expect(config.localeDirs[0].layer).toBe('root')
    expect(config.layerRootDirs).toEqual([tempDir])
  })

  it('discovers locales from public/locales/', async () => {
    createReactProject(tempDir, { localeDir: 'public/locales', hasNextConfig: false, i18nDep: 'react-i18next' })

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.localeDirs[0].path).toBe(join(tempDir, 'public/locales'))
  })

  it('discovers locales from locates/ directory', async () => {
    createReactProject(tempDir, { localeDir: 'locales', i18nDep: 'next-translate' })

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.localeDirs[0].path).toBe(join(tempDir, 'locales'))
  })

  it('throws ConfigError when no locale directory found', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0', 'next-intl': '^3.0.0' },
    }))

    const adapter = new ReactAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No locale directory found')
  })

  it('throws ConfigError when locale dir has no locale subdirectories', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0', 'next-intl': '^3.0.0' },
    }))
    mkdirSync(join(tempDir, 'messages'))

    const adapter = new ReactAdapter()
    await expect(adapter.resolve(tempDir)).rejects.toThrow('No locale files found')
  })

  it('honors locales override from .i18n-mcp.json', async () => {
    createReactProject(tempDir, { locales: ['en', 'de', 'fr', 'es'] })
    writeFileSync(
      join(tempDir, '.i18n-mcp.json'),
      JSON.stringify({ locales: ['en', 'fr'] }),
    )

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['en', 'fr'])
  })

  it('sorts locale codes alphabetically', async () => {
    createReactProject(tempDir, { locales: ['fr', 'en', 'de', 'zh'] })

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en', 'fr', 'zh'])
  })

  it('handles flat JSON layout when no subdirectories found', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0', 'react-i18next': '^14.0.0' },
    }))
    const localeDir = join(tempDir, 'src/locales')
    mkdirSync(localeDir, { recursive: true })
    writeFileSync(join(localeDir, 'en.json'), JSON.stringify({ hello: 'world' }))
    writeFileSync(join(localeDir, 'de.json'), JSON.stringify({ hello: 'welt' }))

    const adapter = new ReactAdapter()
    const config = await adapter.resolve(tempDir)

    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
  })
})

describe('Adapter registry: React vs others', () => {
  beforeEach(() => {
    resetRegistry()
  })

  afterEach(() => {
    resetRegistry()
  })

  it('selects ReactAdapter when Next.js signals present without Nuxt/Vue', async () => {
    const tempDir = join(tmpdir(), `registry-react-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    createReactProject(tempDir)

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new VueAdapter())
      registerAdapter(new ReactAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('react')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('selects NuxtAdapter when Nuxt signals are present', async () => {
    const tempDir = join(tmpdir(), `registry-nuxt-wins-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
    }))
    writeFileSync(
      join(tempDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ i18n: { defaultLocale: "en" } })',
    )

    try {
      registerAdapter(new NuxtAdapter())
      registerAdapter(new ReactAdapter())

      const adapter = await detectFramework(tempDir)
      expect(adapter.name).toBe('nuxt')
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
