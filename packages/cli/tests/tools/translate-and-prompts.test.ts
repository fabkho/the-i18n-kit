import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { resolve, join } from 'node:path'
import { cp, rm, mkdir } from 'node:fs/promises'
import { readLocaleFile } from '../../src/io/json-reader.js'
import { mutateLocaleFile } from '../../src/io/json-writer.js'
import {
  getNestedValue,
  hasNestedKey,
  setNestedValue,
} from '../../src/io/key-operations.js'
import { loadProjectConfig } from '../../src/config/project-config.js'
import { playgroundDir } from '../fixtures/mock-detector.js'
import { computeProgressTotal, resolveSamplingPreferences, DEFAULT_SAMPLING_PREFERENCES, buildTranslationSystemPrompt, buildTranslationUserMessage, extractJsonFromResponse, computeMaxTokens } from '../../src/core/operations.js'

// Temp copy of locale dirs for mutation tests
const tmpDir = resolve(import.meta.dirname, '../../.tmp-translate')
const tmpRootLocales = resolve(tmpDir, 'root')
const tmpAdminLocales = resolve(tmpDir, 'admin')

const playgroundRootLocales = resolve(playgroundDir, 'i18n/locales')
const playgroundAdminLocales = resolve(playgroundDir, 'app-admin/i18n/locales')

const localeFiles = ['de-DE.json', 'en-US.json', 'fr-FR.json', 'es-ES.json']

async function copyLocaleFiles() {
  await mkdir(tmpRootLocales, { recursive: true })
  await mkdir(tmpAdminLocales, { recursive: true })
  await cp(playgroundRootLocales, tmpRootLocales, { recursive: true })
  await cp(playgroundAdminLocales, tmpAdminLocales, { recursive: true })
}

// ─── Prompt assembly helpers (tested via buildTranslationSystemPrompt logic) ──

describe('translation system prompt assembly', () => {
  it('project config has all fields needed for prompt construction', async () => {
    const config = await loadProjectConfig(playgroundDir)
    expect(config).not.toBeNull()
    expect(config!.translationPrompt).toBeDefined()
    expect(config!.glossary).toBeDefined()
    expect(config!.localeNotes).toBeDefined()
    expect(config!.examples).toBeDefined()
  })

  it('glossary terms are available for prompt construction', async () => {
    const config = await loadProjectConfig(playgroundDir)
    expect(config!.glossary!['Buchung']).toContain('Booking')
    expect(config!.glossary!['Ressource']).toContain('Resource')
    expect(config!.glossary!['Termin']).toContain('Appointment')
  })

  it('locale notes exist for all playground locales', async () => {
    const config = await loadProjectConfig(playgroundDir)
    expect(config!.localeNotes!['de-DE']).toBeDefined()
    expect(config!.localeNotes!['en-US']).toBeDefined()
    expect(config!.localeNotes!['fr-FR']).toBeDefined()
    expect(config!.localeNotes!['es-ES']).toBeDefined()
  })

  it('examples have key-value pairs suitable for few-shot prompting', async () => {
    const config = await loadProjectConfig(playgroundDir)
    const example = config!.examples![0]
    expect(example.key).toBe('common.actions.save')
    expect(example['de-DE']).toBe('Speichern')
    expect(example['en-US']).toBe('Save')
    expect(example.note).toBeDefined()
  })
})

// ─── translate_missing: writing translated results ───────────────

describe('translate_missing: writing translations', () => {
  beforeEach(async () => {
    await copyLocaleFiles()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('writes translated keys to a locale file', async () => {
    const filePath = join(tmpAdminLocales, 'es-ES.json')

    // Simulate what translate_missing does after getting translations
    const translations: Record<string, string> = {
      'admin.users.list': 'Lista de usuarios',
      'admin.users.create': 'Crear usuario',
      'admin.users.edit': 'Editar usuario',
    }

    await mutateLocaleFile(filePath, (data) => {
      for (const [key, value] of Object.entries(translations)) {
        setNestedValue(data, key, value)
      }
    })

    const updated = await readLocaleFile(filePath)
    expect(getNestedValue(updated, 'admin.users.list')).toBe('Lista de usuarios')
    expect(getNestedValue(updated, 'admin.users.create')).toBe('Crear usuario')
    expect(getNestedValue(updated, 'admin.users.edit')).toBe('Editar usuario')
    // Existing keys preserved
    expect(getNestedValue(updated, 'admin.dashboard.title')).toBe('Panel de control')
    expect(getNestedValue(updated, 'admin.dashboard.welcome')).toBe('Bienvenido, {name}!')
  })

  it('does not overwrite existing keys when writing translations', async () => {
    const filePath = join(tmpAdminLocales, 'es-ES.json')
    const before = await readLocaleFile(filePath)
    const originalTitle = getNestedValue(before, 'admin.dashboard.title')

    // Simulate translate_missing — only write keys that don't exist yet
    const translations: Record<string, string> = {
      'admin.dashboard.title': 'SHOULD NOT OVERWRITE',
      'admin.users.list': 'Lista de usuarios',
    }

    await mutateLocaleFile(filePath, (data) => {
      for (const [key, value] of Object.entries(translations)) {
        if (!hasNestedKey(data, key)) {
          setNestedValue(data, key, value)
        }
      }
    })

    const updated = await readLocaleFile(filePath)
    expect(getNestedValue(updated, 'admin.dashboard.title')).toBe(originalTitle)
    expect(getNestedValue(updated, 'admin.users.list')).toBe('Lista de usuarios')
  })

  it('handles writing to a file that previously had no keys in the namespace', async () => {
    const filePath = join(tmpAdminLocales, 'es-ES.json')

    // es-ES has no admin.users.* — verify it creates the namespace
    const before = await readLocaleFile(filePath)
    expect(hasNestedKey(before, 'admin.users')).toBe(false)

    await mutateLocaleFile(filePath, (data) => {
      setNestedValue(data, 'admin.users.list', 'Lista de usuarios')
    })

    const after = await readLocaleFile(filePath)
    expect(hasNestedKey(after, 'admin.users')).toBe(true)
    expect(getNestedValue(after, 'admin.users.list')).toBe('Lista de usuarios')
  })

  it('preserves placeholders in translations', async () => {
    const filePath = join(tmpRootLocales, 'fr-FR.json')

    await mutateLocaleFile(filePath, (data) => {
      setNestedValue(data, 'common.messages.greeting', 'Bonjour, {name}!')
    })

    const updated = await readLocaleFile(filePath)
    const value = getNestedValue(updated, 'common.messages.greeting') as string
    expect(value).toBe('Bonjour, {name}!')
    expect(value).toContain('{name}')
  })
})

// ─── translate_missing: progressTotal computation ────────────────

describe('translate_missing: progressTotal computation', () => {
  it('correctly computes total for 2 locales with different missing key counts', () => {
    const missingKeyCounts = [10, 60]
    const maxBatch = 50
    const total = computeProgressTotal(missingKeyCounts, maxBatch)
    // locale 1: ceil(10/50) + 2 = 1 + 2 = 3
    // locale 2: ceil(60/50) + 2 = 2 + 2 = 4
    // total = 7
    expect(total).toBe(7)
  })

  it('excludes locales with 0 missing keys from the total', () => {
    const missingKeyCounts = [5, 0, 3]
    const maxBatch = 50
    const total = computeProgressTotal(missingKeyCounts, maxBatch)
    // locale 1: ceil(5/50) + 2 = 1 + 2 = 3
    // locale 2: 0 missing keys — excluded
    // locale 3: ceil(3/50) + 2 = 1 + 2 = 3
    // total = 6
    expect(total).toBe(6)
  })

  it('formula matches sum(ceil(keys/batch) + 2) per locale with missing keys', () => {
    const missingKeyCounts = [50, 100, 150]
    const maxBatch = 50
    const total = computeProgressTotal(missingKeyCounts, maxBatch)
    // locale 1: ceil(50/50) + 2 = 1 + 2 = 3
    // locale 2: ceil(100/50) + 2 = 2 + 2 = 4
    // locale 3: ceil(150/50) + 2 = 3 + 2 = 5
    // total = 12
    expect(total).toBe(12)
  })

  it('single locale computes correctly', () => {
    const missingKeyCounts = [75]
    const maxBatch = 50
    const total = computeProgressTotal(missingKeyCounts, maxBatch)
    // ceil(75/50) + 2 = 2 + 2 = 4
    expect(total).toBe(4)
  })

  it('all locales with 0 missing keys results in progressTotal of 0', () => {
    const missingKeyCounts = [0, 0, 0]
    const maxBatch = 50
    const total = computeProgressTotal(missingKeyCounts, maxBatch)
    expect(total).toBe(0)
  })
})

// ─── resolveSamplingPreferences ──────────────────────────────────

describe('resolveSamplingPreferences', () => {
  it('returns built-in defaults when no project config is provided', () => {
    const result = resolveSamplingPreferences(undefined)
    expect(result).toEqual(DEFAULT_SAMPLING_PREFERENCES)
  })

  it('returns built-in defaults when project config has no samplingPreferences', () => {
    const result = resolveSamplingPreferences({ context: 'some project' })
    expect(result).toEqual(DEFAULT_SAMPLING_PREFERENCES)
  })

  it('maps string hints to ModelHint objects', () => {
    const result = resolveSamplingPreferences({
      samplingPreferences: { hints: ['sonnet', 'gpt-4o'] },
    })
    expect(result.hints).toEqual([{ name: 'sonnet' }, { name: 'gpt-4o' }])
  })

  it('overrides individual priority fields while keeping defaults for unset fields', () => {
    const result = resolveSamplingPreferences({
      samplingPreferences: { intelligencePriority: 0.9 },
    })
    expect(result.intelligencePriority).toBe(0.9)
    expect(result.costPriority).toBe(DEFAULT_SAMPLING_PREFERENCES.costPriority)
    expect(result.speedPriority).toBe(DEFAULT_SAMPLING_PREFERENCES.speedPriority)
    expect(result.hints).toEqual(DEFAULT_SAMPLING_PREFERENCES.hints)
  })

  it('overrides all fields when fully specified', () => {
    const result = resolveSamplingPreferences({
      samplingPreferences: {
        hints: ['claude'],
        costPriority: 0.1,
        speedPriority: 0.2,
        intelligencePriority: 0.95,
      },
    })
    expect(result).toEqual({
      hints: [{ name: 'claude' }],
      costPriority: 0.1,
      speedPriority: 0.2,
      intelligencePriority: 0.95,
    })
  })

  it('falls back to default hints when hints array is undefined', () => {
    const result = resolveSamplingPreferences({
      samplingPreferences: { costPriority: 0.5 },
    })
    expect(result.hints).toEqual(DEFAULT_SAMPLING_PREFERENCES.hints)
  })

  it('handles empty hints array', () => {
    const result = resolveSamplingPreferences({
      samplingPreferences: { hints: [] },
    })
    expect(result.hints).toEqual([])
  })
})

describe('buildTranslationSystemPrompt', () => {
  it('includes role framing with no project config', () => {
    const result = buildTranslationSystemPrompt(undefined, 'de')
    expect(result).toContain('You are a professional translator')
    expect(result).toContain('{placeholder}')
    expect(result).toContain('Return ONLY a JSON object')
  })

  it('includes role framing even with translationPrompt set', () => {
    const result = buildTranslationSystemPrompt({ translationPrompt: 'Be formal.' }, 'de')
    expect(result).toContain('You are a professional translator')
    expect(result).toContain('Be formal.')
    expect(result).toContain('Return ONLY a JSON object')
  })

  it('includes glossary when provided', () => {
    const result = buildTranslationSystemPrompt({
      glossary: { Booking: 'Buchung', Resource: 'Ressource' },
    }, 'de')
    expect(result).toContain('GLOSSARY')
    expect(result).toContain('Booking → Buchung')
    expect(result).toContain('Resource → Ressource')
  })

  it('includes locale note for the target locale', () => {
    const result = buildTranslationSystemPrompt({
      localeNotes: { de: 'Informal German', fr: 'Formal French' },
    }, 'de')
    expect(result).toContain('TARGET LOCALE NOTE (de): Informal German')
    expect(result).not.toContain('Formal French')
  })

  it('includes examples when provided', () => {
    const result = buildTranslationSystemPrompt({
      examples: [{ key: 'save', de: 'Speichern', note: 'imperative' }],
    }, 'de')
    expect(result).toContain('STYLE EXAMPLES')
    expect(result).toContain('save')
    expect(result).toContain('Speichern')
    expect(result).toContain('imperative')
  })

  it('includes all fields in correct order when all are set', () => {
    const result = buildTranslationSystemPrompt({
      translationPrompt: 'Keep it short.',
      glossary: { Save: 'Speichern' },
      localeNotes: { de: 'Use du.' },
      examples: [{ key: 'ok', de: 'OK' }],
    }, 'de')
    const roleIdx = result.indexOf('You are a professional translator')
    const promptIdx = result.indexOf('Keep it short.')
    const glossaryIdx = result.indexOf('GLOSSARY')
    const noteIdx = result.indexOf('TARGET LOCALE NOTE')
    const examplesIdx = result.indexOf('STYLE EXAMPLES')
    const formatIdx = result.indexOf('Return ONLY a JSON object')
    expect(roleIdx).toBeLessThan(promptIdx)
    expect(promptIdx).toBeLessThan(glossaryIdx)
    expect(glossaryIdx).toBeLessThan(noteIdx)
    expect(noteIdx).toBeLessThan(examplesIdx)
    expect(examplesIdx).toBeLessThan(formatIdx)
  })

  it('uses :placeholder instruction for php-array format', () => {
    const result = buildTranslationSystemPrompt(undefined, 'de', 'php-array')
    expect(result).toContain(':placeholder')
    expect(result).not.toContain('{placeholder}')
  })
})

describe('buildTranslationUserMessage', () => {
  it('includes reference and target locale codes', () => {
    const result = buildTranslationUserMessage('en', 'de', { hello: 'Hello' })
    expect(result).toContain('from en to de')
  })

  it('uses compact JSON without indentation', () => {
    const result = buildTranslationUserMessage('en', 'de', { hello: 'Hello', bye: 'Goodbye' })
    expect(result).toContain('{"hello":"Hello","bye":"Goodbye"}')
    expect(result).not.toContain('  "hello"')
  })

  it('does not include format instruction', () => {
    const result = buildTranslationUserMessage('en', 'de', { hello: 'Hello' })
    expect(result).not.toContain('Return ONLY')
  })

  it('includes placeholder instruction', () => {
    const result = buildTranslationUserMessage('en', 'de', { hello: 'Hello' })
    expect(result).toContain('{placeholder}')
  })

  it('uses :placeholder instruction for php-array format', () => {
    const result = buildTranslationUserMessage('en', 'de', { hello: 'Hello' }, 'php-array')
    expect(result).toContain(':placeholder')
  })
})

describe('extractJsonFromResponse', () => {
  it('parses clean JSON directly', () => {
    const result = extractJsonFromResponse('{"key":"value"}')
    expect(result).toEqual({ key: 'value' })
  })

  it('strips markdown code fences', () => {
    const result = extractJsonFromResponse('```json\n{"key":"value"}\n```')
    expect(result).toEqual({ key: 'value' })
  })

  it('strips bare code fences without language tag', () => {
    const result = extractJsonFromResponse('```\n{"key":"value"}\n```')
    expect(result).toEqual({ key: 'value' })
  })

  it('extracts JSON from prose-prefixed response', () => {
    const result = extractJsonFromResponse('Here are your translations:\n{"key":"value"}')
    expect(result).toEqual({ key: 'value' })
  })

  it('handles nested objects in values', () => {
    const input = 'Some text {"a":"1","b":"val with } brace"} trailing'
    const result = extractJsonFromResponse(input)
    expect(result).toEqual({ a: '1', b: 'val with } brace' })
  })

  it('extracts first JSON object when multiple exist', () => {
    const result = extractJsonFromResponse('{"first":"1"}\n{"second":"2"}')
    expect(result).toEqual({ first: '1' })
  })

  it('throws when no JSON is present', () => {
    expect(() => extractJsonFromResponse('No JSON here at all')).toThrow('No valid JSON object')
  })

  it('handles whitespace around JSON', () => {
    const result = extractJsonFromResponse('  \n  {"key":"value"}  \n  ')
    expect(result).toEqual({ key: 'value' })
  })
})

describe('computeMaxTokens', () => {
  it('returns the fixed budget regardless of batch size', () => {
    expect(computeMaxTokens(1)).toBe(16384)
    expect(computeMaxTokens(50)).toBe(16384)
    expect(computeMaxTokens(1000)).toBe(16384)
  })
})
