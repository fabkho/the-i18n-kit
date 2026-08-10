import type { I18nConfig } from '../../src/config/types.js'

type DetectorModule = typeof import('../../src/config/detector.js')

/**
 * Detector-mock factory backed by a mutable holder: tests assign
 * `holder.config` and every `detectI18nConfig` call returns it, regardless
 * of projectDir. This file must stay free of `vi.mock` literals (they would
 * be hoisted on import); use it from inside a test file's factory:
 *
 * ```ts
 * const holder = vi.hoisted(() => ({ config: undefined as unknown }))
 * vi.mock('../../src/config/detector.js', async importOriginal =>
 *   (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))
 * ```
 */
export async function holderDetectorMock(
  holder: { config: unknown },
  importOriginal: <T>() => Promise<T>,
): Promise<DetectorModule> {
  const original = await importOriginal<DetectorModule>()
  return {
    ...original,
    detectI18nConfig: (async () => {
      if (!holder.config) throw new Error('Test config not initialized')
      return holder.config as I18nConfig
    }) as DetectorModule['detectI18nConfig'],
    clearConfigCache: () => { },
    getCachedConfig: () => ((holder.config as I18nConfig | undefined) ?? null),
  }
}
