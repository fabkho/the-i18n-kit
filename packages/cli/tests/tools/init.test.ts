import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initProjectConfig } from '../../src/core/operations.js'
import { loadProjectConfig, CONFIG_FILENAME } from '../../src/config/project-config.js'
import { clearConfigCache } from '../../src/config/detector.js'

/**
 * `init` (#249). Run against real temp directories rather than mocks, because
 * the whole point is that the emitted file is one the tool then accepts —
 * which only a round trip through the real loader can show.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-init-'))
  clearConfigCache()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const readConfig = async () => JSON.parse(await readFile(join(dir, CONFIG_FILENAME), 'utf-8'))

async function bareProjectWithLocales() {
  await mkdir(join(dir, 'locales'), { recursive: true })
  await writeFile(join(dir, 'locales/en.json'), JSON.stringify({ a: { b: 'Hello' }, c: 'World' }))
  await writeFile(join(dir, 'locales/de.json'), JSON.stringify({ a: { b: 'Hallo' } }))
}

describe('init on a project with no framework', () => {
  it('writes the locale config the generic adapter needs to activate', async () => {
    await bareProjectWithLocales()

    const result = await initProjectConfig({ projectDir: dir })

    expect(result.written).toBe(true)
    expect(result.detected.adapter).toBe('generic')
    expect(result.config.localeDirs).toEqual(['locales'])
    expect(result.config.locales).toEqual(['de', 'en'])
  })

  it('emits a config the loader then accepts', async () => {
    await bareProjectWithLocales()
    await initProjectConfig({ projectDir: dir })

    // The criterion that matters: a generated config the tool would reject is
    // a bug, so round-trip it through the real loader.
    await expect(loadProjectConfig(dir)).resolves.toMatchObject({
      localeDirs: ['locales'],
      defaultLocale: 'en',
    })
  })

  // #296: picking the alphabetically first locale is how a project silently
  // ends up treating German as its source language.
  it('picks the fullest locale as the reference, not the alphabetically first', async () => {
    await bareProjectWithLocales()

    const result = await initProjectConfig({ projectDir: dir })

    expect(result.config.defaultLocale).toBe('en')
  })

  it('falls back to a template when there is nothing to point at', async () => {
    const result = await initProjectConfig({ projectDir: dir })

    expect(result.config.localeDirs).toEqual(['locales'])
    expect(result.detected.note).toMatch(/no locale directory/i)
  })
})

describe('init on a framework project', () => {
  const fixture = resolve(import.meta.dirname, '../fixtures/nuxt-project')

  beforeEach(async () => {
    await cp(fixture, dir, { recursive: true })
    await rm(join(dir, CONFIG_FILENAME), { force: true })
  })

  // The amended criterion 1: writing a copy of what nuxt.config already states
  // is the duplicated source of truth #305 exists to remove.
  it('writes nothing the adapter can derive', async () => {
    const result = await initProjectConfig({ projectDir: dir })

    expect(result.detected.adapter).toBe('nuxt')
    expect(result.detected.derivesLocaleConfig).toBe(true)
    expect(result.config).not.toHaveProperty('locales')
    expect(result.config).not.toHaveProperty('localeDirs')
    expect(result.config).not.toHaveProperty('defaultLocale')
  })

  it('reports the matched adapter and its confidence', async () => {
    const result = await initProjectConfig({ projectDir: dir })

    expect(result.detected.label).toBe('Nuxt')
    expect(result.detected.confidence).toBeGreaterThan(0)
  })

  it('still emits the authoring scaffolding, which no adapter can derive', async () => {
    const result = await initProjectConfig({ projectDir: dir })

    expect(result.config).toMatchObject({
      context: '',
      glossary: {},
      translationPrompt: '',
      localeNotes: {},
    })
    expect(result.config.$schema).toContain('schema.json')
  })
})

describe('init safety', () => {
  it('refuses to overwrite an existing config', async () => {
    await bareProjectWithLocales()
    await writeFile(join(dir, CONFIG_FILENAME), '{"defaultLocale":"fr"}')

    await expect(initProjectConfig({ projectDir: dir })).rejects.toThrow(/already exists/)
    expect(await readConfig()).toEqual({ defaultLocale: 'fr' })
  })

  it('overwrites with force, refreshing the authoring scaffolding', async () => {
    await bareProjectWithLocales()
    await writeFile(join(dir, CONFIG_FILENAME), '{"defaultLocale":"fr"}')

    const result = await initProjectConfig({ projectDir: dir, force: true })

    expect(result.overwritten).toBe(true)
    expect(await readConfig()).toMatchObject({ glossary: {}, localeNotes: {} })
  })

  // --force means "replace the file", not "discard my locale wiring". Resetting
  // a hand-set defaultLocale would be the same silent config mutation that let
  // a project machine-translate its protected locale for months.
  it('preserves hand-written locale settings when forcing', async () => {
    await bareProjectWithLocales()
    await writeFile(join(dir, CONFIG_FILENAME), '{"defaultLocale":"fr","localeDirs":["custom"]}')

    const result = await initProjectConfig({ projectDir: dir, force: true })

    expect(result.config.defaultLocale).toBe('fr')
    expect(result.config.localeDirs).toEqual(['custom'])
  })

  // Regression: the generic adapter only detects when a config already exists,
  // so --force runs through the detected path. Regenerating the scaffold alone
  // would strip localeDirs and leave the project unresolvable.
  it('keeps the locale config when forcing over a working generic project', async () => {
    await bareProjectWithLocales()
    await initProjectConfig({ projectDir: dir })
    clearConfigCache()

    const result = await initProjectConfig({ projectDir: dir, force: true })

    expect(result.config.localeDirs).toEqual(['locales'])
    expect(result.config.defaultLocale).toBe('en')
    await expect(loadProjectConfig(dir)).resolves.toMatchObject({ localeDirs: ['locales'] })
  })

  it('touches no files on a dry run', async () => {
    await bareProjectWithLocales()

    const result = await initProjectConfig({ projectDir: dir, dryRun: true })

    expect(result.written).toBe(false)
    expect(result.config.localeDirs).toEqual(['locales'])
    expect(existsSync(join(dir, CONFIG_FILENAME))).toBe(false)
  })

  it('reports a dry run over an existing config without writing', async () => {
    await bareProjectWithLocales()
    await writeFile(join(dir, CONFIG_FILENAME), '{"defaultLocale":"fr"}')

    // Still guarded: --dryRun alone must not imply permission to overwrite.
    await expect(initProjectConfig({ projectDir: dir, dryRun: true })).rejects.toThrow(/already exists/)
  })
})
