import { describe, expect, it, afterAll } from 'vitest'
import { appAdminDir, registerDetectorMock } from '../fixtures/mock-detector.js'

registerDetectorMock()

const {
  clearConfigCache,
} = await import('../../src/config/detector.js')
const {
  translateKey,
  translateMissing,
  validatePlaceholders,
} = await import('../../src/core/operations.js')

afterAll(() => {
  clearConfigCache()
})

describe('translate_key', () => {
  it('dry-runs source-based translation for all target locales', async () => {
    const result = await translateKey({
      projectDir: appAdminDir,
      layer: 'root',
      key: 'admin.users.export',
      sourceLocale: 'en-US',
      sourceValue: 'Export {count} users',
      targetLocales: 'all',
      dryRun: true,
      includePreview: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.mode).toBe('dry-run')
    expect(result.sourceLocale).toMatchObject({ code: 'en', language: 'en-US', file: 'en-US.json' })
    expect(result.updatedSource).toBe(true)
    expect(result.translated).toEqual([])
    expect(result.wouldTranslate).toEqual(expect.arrayContaining(['de', 'fr', 'es']))
    expect(result.placeholderValidation).toEqual({
      ok: true,
      placeholders: ['{count}'],
      errors: [],
    })
    expect(result.preview).toEqual({ en: 'Export {count} users' })
  })

  it('deduplicates explicit targets and excludes source locale', async () => {
    const result = await translateKey({
      projectDir: appAdminDir,
      layer: 'root',
      key: 'admin.users.export',
      sourceLocale: 'en-US',
      sourceValue: 'Export users',
      targetLocales: ['en-US', 'de-DE', 'de-DE.json', 'fr-FR'],
      dryRun: true,
    })

    expect(result.wouldTranslate).toEqual(['de', 'fr'])
  })

  it('skips existing targets when overwrite is false', async () => {
    const result = await translateKey({
      projectDir: appAdminDir,
      layer: 'root',
      key: 'admin.dashboard.title',
      sourceLocale: 'en-US',
      targetLocales: ['de-DE', 'fr-FR'],
      overwrite: false,
      dryRun: true,
    })

    expect(result.wouldTranslate).toEqual([])
    expect(result.skipped).toEqual([
      { locale: 'de', reason: 'already-translated' },
      { locale: 'fr', reason: 'already-translated' },
    ])
  })
})

describe('placeholder validation', () => {
  it('detects missing and extra placeholders', () => {
    const result = validatePlaceholders(
      'bookingCreator.options.removeSubResource',
      'Remove {subResource}',
      [
        { locale: 'de', value: '{resource} entfernen' },
        { locale: 'fr', value: 'Supprimer {subResource}' },
      ],
    )

    expect(result.ok).toBe(false)
    expect(result.placeholders).toEqual(['{subResource}'])
    expect(result.errors).toEqual([
      {
        locale: 'de',
        key: 'bookingCreator.options.removeSubResource',
        missing: ['{subResource}'],
        extra: ['{resource}'],
      },
    ])
  })
})

describe('translate_missing compact mode', () => {
  it('keeps fallback contexts, message, reasons, and locale metadata in compact output', async () => {
    const result = await translateMissing({
      projectDir: appAdminDir,
      layer: 'root',
      referenceLocale: 'de-DE',
      targetLocales: ['es-ES'],
      keys: ['admin.users.list'],
      compact: true,
      // no translateFn — the no-backend fallback path
    })

    // fallback contexts survive compaction (guidance messages are surface-owned)
    expect(result.fallbackContexts).toHaveProperty('es')
    expect(result.summary.mode).toBe('agent')

    // locale metadata as full triples
    expect(result.summary.referenceLocale).toMatchObject({ code: 'de', language: 'de-DE', file: 'de-DE.json' })
    expect(result.summary.targetLocales).toEqual([
      expect.objectContaining({ code: 'es', language: 'es-ES', file: 'es-ES.json' }),
    ])

    // per-locale entries keep all non-key metadata; per-key arrays become counts
    expect(result.summary.byLocale).toEqual([
      expect.objectContaining({ locale: 'es', mode: 'agent', missing: 1, skipped: 1, translated: 0, failed: 0 }),
    ])
    expect(result.summary.layer).toBe('root')
    expect(result.summary.dryRun).toBe(false)

    // compact drops only per-key detail
    expect(result.results).toBeUndefined()
  })

  it('reports dryRun in compact output', async () => {
    const result = await translateMissing({
      projectDir: appAdminDir,
      layer: 'root',
      referenceLocale: 'de-DE',
      targetLocales: ['es-ES'],
      keys: ['admin.users.list'],
      compact: true,
      dryRun: true,
    })

    expect(result.summary.dryRun).toBe(true)
    expect(result.summary.totalWouldTranslate).toBe(1)
    expect(result.summary.byLocale).toEqual([
      expect.objectContaining({ locale: 'es', wouldTranslate: 1, translated: 0, mode: 'dry-run' }),
    ])
    expect(result.fallbackContexts).toBeUndefined()
  })

  it('omits fallback contexts from compact output when nothing is missing', async () => {
    const result = await translateMissing({
      projectDir: appAdminDir,
      layer: 'root',
      referenceLocale: 'de-DE',
      targetLocales: ['es-ES'],
      keys: ['admin.dashboard.title'],
      compact: true,
    })

    expect(result.fallbackContexts).toBeUndefined()
    expect(result.summary.message).toBeUndefined()
    expect(result.summary.totalTranslated).toBe(0)
    expect(result.summary.byLocale).toEqual([
      expect.objectContaining({ locale: 'es', missing: 0, translated: 0, failed: 0, skipped: 0 }),
    ])
  })
})

describe('translate_missing metadata', () => {
  it('returns locale metadata and per-locale reason', async () => {
    const result = await translateMissing({
      projectDir: appAdminDir,
      layer: 'root',
      referenceLocale: 'de-DE',
      targetLocales: ['es-ES'],
      keys: ['admin.users.list'],
      dryRun: true,
    })

    expect(result.summary.referenceLocale).toMatchObject({ code: 'de', language: 'de-DE', file: 'de-DE.json' })
    expect(result.summary.targetLocales).toEqual([
      expect.objectContaining({ code: 'es', language: 'es-ES', file: 'es-ES.json' }),
    ])
    expect(result.results.es).toMatchObject({
      wouldTranslate: ['admin.users.list'],
      translated: [],
      failed: [],
      mode: 'dry-run',
      missing: 1,
    })
  })
})
