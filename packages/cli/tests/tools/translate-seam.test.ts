import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { TranslateFn } from '../../src/core/types.js'
import { translateMissing } from '../../src/core/operations.js'
import { clearConfigCache } from '../../src/config/detector.js'

/**
 * Seam tests: drive the real translateMissing pipeline end to end with fake
 * translate functions against a real temp project (resolved by the generic
 * adapter — no mocks anywhere). Batching, response parsing, placeholder
 * validation, file writes, and result shapes are asserted from observable
 * outputs only.
 */

let projectDir: string
let localesDir: string

const deContent = {
  greeting: 'Hallo {name}',
  actions: {
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
  },
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-seam-'))
  localesDir = join(projectDir, 'i18n', 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(projectDir, '.i18n-mcp.json'), JSON.stringify({
    localeDirs: [{ path: 'i18n/locales', layer: 'root' }],
    defaultLocale: 'de',
    locales: ['de', 'en', 'fr'],
  }, null, 2))
  await writeFile(join(localesDir, 'de.json'), JSON.stringify(deContent, null, 2))
  await writeFile(join(localesDir, 'en.json'), '{}\n')
  await writeFile(join(localesDir, 'fr.json'), '{}\n')
  clearConfigCache()
})

afterEach(async () => {
  await chmod(localesDir, 0o755).catch(() => {})
  await rm(projectDir, { recursive: true, force: true })
  clearConfigCache()
})

/** Extract the batch (compact single-line JSON) from the user message. */
function parseBatch(userMessage: string): Record<string, string> {
  const line = userMessage.split('\n').find(l => l.trimStart().startsWith('{"'))
  if (!line) throw new Error(`No batch JSON found in user message:\n${userMessage}`)
  return JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)) as Record<string, string>
}

/** A well-behaved fake backend: translates every requested key. */
function fakeTranslator(transform: (key: string, value: string) => string, wrap?: (json: string) => string): TranslateFn {
  return async ({ userMessage }) => {
    const batch = parseBatch(userMessage)
    const out = Object.fromEntries(Object.entries(batch).map(([k, v]) => [k, transform(k, v)]))
    const json = JSON.stringify(out)
    return { text: wrap ? wrap(json) : json, model: 'fake-model' }
  }
}

async function readLocale(code: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(localesDir, `${code}.json`), 'utf-8')) as Record<string, unknown>
}

describe('translateMissing through the translate seam', () => {
  it('translates missing keys and writes them to the target locale files', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      translateFn: fakeTranslator((_k, v) => `[t] ${v}`),
    })

    expect(result.summary.totalTranslated).toBe(8) // 4 keys × en + fr
    expect(result.summary.totalFailed).toBe(0)
    expect(result.summary.mode).toBe('provider')
    expect(result.results.en).toMatchObject({
      mode: 'provider',
      missing: 4,
      model: 'fake-model',
      failed: [],
      skipped: [],
    })
    expect(result.results.en.translated).toHaveLength(4)

    const en = await readLocale('en')
    expect(en).toMatchObject({
      greeting: '[t] Hallo {name}',
      actions: { save: '[t] Speichern', cancel: '[t] Abbrechen', delete: '[t] Löschen' },
    })
    const fr = await readLocale('fr')
    expect(fr).toMatchObject({ greeting: '[t] Hallo {name}' })
  })

  it('parses responses wrapped in markdown code fences', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      translateFn: fakeTranslator((_k, v) => `[t] ${v}`, json => '```json\n' + json + '\n```'),
    })

    expect(result.results.en.translated).toHaveLength(4)
    expect((await readLocale('en')).greeting).toBe('[t] Hallo {name}')
  })

  it('rejects translations with placeholder mismatches and does not write them', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      translateFn: fakeTranslator((k, v) =>
        k === 'greeting' ? 'Hello {nom}' : `[t] ${v}`),
    })

    expect(result.results.en.failed).toEqual([{ key: 'greeting', reason: 'placeholder-mismatch' }])
    expect(result.results.en.translated).toHaveLength(3)
    expect(result.results.en.placeholderValidation?.ok).toBe(false)

    const en = await readLocale('en')
    expect(en.greeting).toBeUndefined()
    expect((en.actions as Record<string, string>).save).toBe('[t] Speichern')
  })

  it('splits keys into batches of batchSize', async () => {
    let calls = 0
    const counting: TranslateFn = async (req) => {
      calls++
      const batch = parseBatch(req.userMessage)
      expect(Object.keys(batch).length).toBeLessThanOrEqual(2)
      return {
        // keep source values so placeholder validation passes
        text: JSON.stringify(Object.fromEntries(Object.entries(batch).map(([k, v]) => [k, `[t] ${v}`]))),
        model: 'fake-model',
      }
    }

    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      batchSize: 2,
      translateFn: counting,
    })

    expect(calls).toBe(2) // 4 keys / batchSize 2
    expect(result.results.en.batches).toBe(2)
    expect(result.results.en.translated).toHaveLength(4)
  })

  // generous timeout: the production retry waits 4s before the second attempt
  it('fails the whole batch when the backend returns unusable output twice', { timeout: 15_000 }, async () => {
    let calls = 0
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      translateFn: async () => {
        calls++
        return { text: 'sorry, no JSON here', model: 'fake-model' }
      },
    })

    expect(calls).toBe(2) // initial attempt + one retry
    expect(result.results.en.translated).toEqual([])
    expect(result.results.en.failed).toHaveLength(4)
    expect(result.summary.totalFailed).toBe(4)
    expect(await readLocale('en')).toEqual({})
  })

  it('accounts for keys omitted by the backend as failed', async () => {
    // The backend drops one key from its response — it must land in failed
    // with an explicit reason so totals always reconcile.
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      translateFn: async ({ userMessage }) => {
        const batch = parseBatch(userMessage)
        delete batch.greeting
        return {
          text: JSON.stringify(Object.fromEntries(Object.keys(batch).map(k => [k, `x-${k}`]))),
          model: 'fake-model',
        }
      },
    })

    expect(result.results.en.translated).toHaveLength(3)
    expect(result.results.en.failed).toEqual([{ key: 'greeting', reason: 'omitted-by-model' }])
    expect(result.results.en.missing).toBe(4) // translated + failed reconcile
    expect((await readLocale('en')).greeting).toBeUndefined()
  })

  it.skipIf(process.getuid?.() === 0)('reports writeError when the locale file cannot be written', async () => {
    await chmod(localesDir, 0o555)

    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      translateFn: fakeTranslator((_k, v) => `[t] ${v}`),
    })

    expect(result.results.en.writeError).toBeDefined()
    expect(result.results.en.translated).toEqual([])
    expect(result.results.en.failed).toHaveLength(4)
  })

  describe('plural variant validation', () => {
    beforeEach(async () => {
      // Replace the source locale with vue-i18n pipe plurals (and one value
      // with a bare pipe that must NOT be treated as plural).
      await writeFile(join(localesDir, 'de.json'), JSON.stringify({
        requests: '{count} Anfrage | {count} Anfragen',
        mode: 'Drücke {key} für A|B-Modus',
      }, null, 2))
    })

    it('rejects a plural dropping a placeholder in one variant as placeholder-mismatch', async () => {
      const result = await translateMissing({
        projectDir,
        layer: 'root',
        targetLocales: ['en'],
        translateFn: fakeTranslator((k, v) =>
          // whole-value {count} set still matches — only the singular drops it
          k === 'requests' ? 'One request | {count} requests' : `[t] ${v}`),
      })

      expect(result.results.en.failed).toEqual([{ key: 'requests', reason: 'placeholder-mismatch' }])
      expect(result.results.en.translated).toEqual(['mode'])
      expect((await readLocale('en')).requests).toBeUndefined()
    })

    it('rejects a translation with more variants than the source as plural-mismatch', async () => {
      const result = await translateMissing({
        projectDir,
        layer: 'root',
        targetLocales: ['en'],
        translateFn: fakeTranslator((k, v) =>
          k === 'requests' ? '{count} request | {count} requests | {count} many requests' : `[t] ${v}`),
      })

      expect(result.results.en.failed).toEqual([{ key: 'requests', reason: 'plural-mismatch' }])
      expect(result.results.en.placeholderValidation?.errors).toEqual([
        expect.objectContaining({ key: 'requests', kind: 'plural-count', sourceVariants: 2, targetVariants: 3 }),
      ])
      expect((await readLocale('en')).requests).toBeUndefined()
    })

    it('accepts a valid plural and writes it', async () => {
      const result = await translateMissing({
        projectDir,
        layer: 'root',
        targetLocales: ['en'],
        translateFn: fakeTranslator((k, v) =>
          k === 'requests' ? '{count} request | {count} requests' : `[t] ${v}`),
      })

      expect(result.results.en.failed).toEqual([])
      expect(result.results.en.translated).toEqual(expect.arrayContaining(['requests', 'mode']))
      expect((await readLocale('en')).requests).toBe('{count} request | {count} requests')
    })

    it('does not treat a bare pipe without surrounding spaces as a plural', async () => {
      const result = await translateMissing({
        projectDir,
        layer: 'root',
        targetLocales: ['en'],
        translateFn: fakeTranslator((k, v) =>
          k === 'mode' ? 'Press {key} for A|B mode' : `[t] ${v}`),
      })

      expect(result.results.en.failed).toEqual([])
      expect((await readLocale('en')).mode).toBe('Press {key} for A|B mode')
    })
  })

  it('returns fallback contexts instead of translating when no backend is provided', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      // no translateFn
    })

    expect(result.summary.mode).toBe('agent')
    expect(result.summary.totalSkipped).toBe(4)
    expect(result.fallbackContexts?.en).toMatchObject({
      keysToTranslate: expect.objectContaining({ greeting: 'Hallo {name}' }),
    })
    expect(result.results.en.mode).toBe('agent')
    expect(result.results.en.skipped).toEqual(
      expect.arrayContaining([{ key: 'greeting', reason: 'no-provider' }]),
    )
    expect(result.results.en.failed).toEqual([])
    expect(await readLocale('en')).toEqual({})
  })
})
