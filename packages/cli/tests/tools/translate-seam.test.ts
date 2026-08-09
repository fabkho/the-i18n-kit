import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { SamplingFn } from '../../src/core/types.js'
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
function fakeTranslator(transform: (key: string, value: string) => string, wrap?: (json: string) => string): SamplingFn {
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
      samplingFn: fakeTranslator((_k, v) => `[t] ${v}`),
    })

    expect(result.summary.totalTranslated).toBe(8) // 4 keys × en + fr
    expect(result.summary.totalFailed).toBe(0)
    expect(result.results.en).toMatchObject({
      samplingUsed: true,
      reason: 'translated-with-sampling',
      model: 'fake-model',
      failed: [],
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
      samplingFn: fakeTranslator((_k, v) => `[t] ${v}`, json => '```json\n' + json + '\n```'),
    })

    expect(result.results.en.translated).toHaveLength(4)
    expect((await readLocale('en')).greeting).toBe('[t] Hallo {name}')
  })

  it('rejects translations with placeholder mismatches and does not write them', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      samplingFn: fakeTranslator((k, v) =>
        k === 'greeting' ? 'Hello {nom}' : `[t] ${v}`),
    })

    expect(result.results.en.failed).toEqual(['greeting'])
    expect(result.results.en.translated).toHaveLength(3)
    expect(result.results.en.placeholderValidation?.ok).toBe(false)

    const en = await readLocale('en')
    expect(en.greeting).toBeUndefined()
    expect((en.actions as Record<string, string>).save).toBe('[t] Speichern')
  })

  it('splits keys into batches of batchSize', async () => {
    let calls = 0
    const counting: SamplingFn = async (req) => {
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
      samplingFn: counting,
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
      samplingFn: async () => {
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

  it('pins current accounting for keys omitted by the backend', async () => {
    // The backend drops one key from its response. Today the omitted key is
    // neither translated nor failed — #207 will move it to failed with
    // reason 'omitted-by-model'. This test pins the current behavior.
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      samplingFn: async ({ userMessage }) => {
        const batch = parseBatch(userMessage)
        delete batch.greeting
        return {
          text: JSON.stringify(Object.fromEntries(Object.keys(batch).map(k => [k, `x-${k}`]))),
          model: 'fake-model',
        }
      },
    })

    expect(result.results.en.translated).toHaveLength(3)
    expect(result.results.en.failed).toEqual([])
    expect((await readLocale('en')).greeting).toBeUndefined()
  })

  it.skipIf(process.getuid?.() === 0)('reports writeError when the locale file cannot be written', async () => {
    await chmod(localesDir, 0o555)

    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      samplingFn: fakeTranslator((_k, v) => `[t] ${v}`),
    })

    expect(result.results.en.writeError).toBeDefined()
    expect(result.results.en.translated).toEqual([])
    expect(result.results.en.failed).toHaveLength(4)
  })

  it('returns fallback contexts instead of translating when no backend is provided', async () => {
    const result = await translateMissing({
      projectDir,
      layer: 'root',
      targetLocales: ['en'],
      // no samplingFn
    })

    expect(result.summary.samplingSupported).toBe(false)
    expect(result.fallbackContexts?.en).toMatchObject({
      keysToTranslate: expect.objectContaining({ greeting: 'Hallo {name}' }),
    })
    expect(result.results.en.reason).toBe('sampling-unavailable')
    expect(await readLocale('en')).toEqual({})
  })
})
