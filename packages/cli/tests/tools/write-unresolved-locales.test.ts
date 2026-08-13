import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * A write naming a locale ref that resolves to nothing must say so in the
 * result (#301). Previously it warned on stderr and returned a clean success:
 * the key still appeared in `written` because the other locales succeeded, so
 * over MCP — where stderr is the server's own log — the caller could not tell
 * a four-locale write from a three-locale one.
 *
 * The locale table mirrors anny-ui's, where `de` and `de-formal` share the
 * language tag `de-DE`.
 */
let tempDir: string

vi.mock('../../src/config/detector.js', async () => {
  const { resolve } = await import('node:path')
  return {
    detectI18nConfig: vi.fn(async (projectDir: string) => ({
      rootDir: projectDir,
      defaultLocale: 'de',
      fallbackLocale: { default: ['de'] },
      locales: [
        { code: 'de', language: 'de-DE', file: 'de-DE.json' },
        { code: 'de-formal', language: 'de-DE', file: 'de-DE-formal.json' },
        { code: 'en', language: 'en-GB', file: 'en-GB.json' },
      ],
      localeDirs: [
        { path: resolve(projectDir, 'locales'), layer: 'root', layerRootDir: projectDir },
      ],
      layerRootDirs: [projectDir],
      projectConfig: {},
      apps: [{ name: 'root', rootDir: projectDir, layers: ['root'] }],
    })),
    clearConfigCache: vi.fn(),
    getCachedConfig: vi.fn(() => null),
  }
})

const { writeTranslations } = await import('../../src/core/operations.js')

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'i18n-unresolved-'))
  await mkdir(join(tempDir, 'locales'), { recursive: true })
  for (const f of ['de-DE.json', 'de-DE-formal.json', 'en-GB.json']) {
    await writeFile(join(tempDir, 'locales', f), '{}\n')
  }
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const read = async (file: string) =>
  JSON.parse(await readFile(resolve(tempDir, 'locales', file), 'utf-8'))

describe('write_translations with an unresolvable locale ref', () => {
  it('reports the dropped ref instead of reading as a clean success', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: {
        'common.save': { 'de': 'Speichern', 'en': 'Save', 'de-DE-formal': 'Speichern Sie' },
      },
    })

    expect(result.unresolvedLocales).toEqual([
      expect.objectContaining({ ref: 'de-DE-formal', keys: ['common.save'] }),
    ])
    // The failure mode: the key is still reported written, because two locales
    // did succeed. The new field is what distinguishes the two cases.
    expect(result.written).toContain('common.save')
    expect(result.filesWritten).toBe(2)
  })

  it('carries the "did you mean" hint into the result, not only stderr', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: { 'common.save': { 'de': 'Speichern', 'de-DE-formal': 'Speichern Sie' } },
    })

    expect(result.unresolvedLocales?.[0]?.suggestion).toMatch(/de-formal/)
  })

  it('also surfaces it in warnings, for callers that only read those', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: { 'common.save': { 'de': 'Speichern', 'de-DE-formal': 'x' } },
    })

    expect(result.warnings?.join('\n')).toMatch(/de-DE-formal.*matched no known locale/)
  })

  it('does not write the dropped locale to disk', async () => {
    await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: { 'common.save': { 'de': 'Speichern', 'de-DE-formal': 'Speichern Sie' } },
    })

    expect(await read('de-DE.json')).toEqual({ common: { save: 'Speichern' } })
    expect(await read('de-DE-formal.json')).toEqual({})
  })

  it('groups every affected key under one entry per ref', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: {
        'a.one': { 'de': '1', 'de-DE-formal': '1' },
        'a.two': { 'de': '2', 'de-DE-formal': '2' },
      },
    })

    expect(result.unresolvedLocales).toHaveLength(1)
    expect(result.unresolvedLocales?.[0]?.keys).toEqual(['a.one', 'a.two'])
  })

  it('reports it on a dry run too, before anything is written', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      dryRun: true,
      translations: { 'common.save': { 'de': 'Speichern', 'de-DE-formal': 'x' } },
    })

    expect(result.dryRun).toBe(true)
    expect(result.unresolvedLocales?.[0]?.ref).toBe('de-DE-formal')
  })
})

describe('write_translations with an ambiguous locale ref', () => {
  it('reports a ref that matches several locales rather than silently first-matching', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: { 'common.save': { 'de-DE': 'Speichern' } },
    })

    expect(result.ambiguousLocales).toEqual([
      { ref: 'de-DE', matchedBy: 'language', candidates: ['de', 'de-formal'], resolvedTo: 'de' },
    ])
    // It still resolves — this is a warning, not a refusal.
    expect(await read('de-DE.json')).toEqual({ common: { save: 'Speichern' } })
  })
})

describe('a fully successful write is unchanged', () => {
  it('adds neither field when every ref resolves uniquely', async () => {
    const result = await writeTranslations({
      layer: 'root',
      projectDir: tempDir,
      translations: {
        'common.save': { 'de': 'Speichern', 'de-formal': 'Speichern Sie', 'en': 'Save' },
      },
    })

    expect(result).not.toHaveProperty('unresolvedLocales')
    expect(result).not.toHaveProperty('ambiguousLocales')
    expect(result.filesWritten).toBe(3)
    expect(result.warnings).toBeUndefined()
  })
})
