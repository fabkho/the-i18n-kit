/**
 * Normalise `@nuxtjs/i18n`'s `fallbackLocale` — a string, an array, or a
 * per-locale map — into the single map shape the rest of the CLI reads.
 *
 * Shared by both paths on purpose. The Nuxt module publishes this value exactly
 * as Nuxt resolved it rather than normalising it itself: two implementations of
 * the same normalisation, in two packages that do not depend on each other, is
 * precisely the drift the module exists to remove.
 */
export function normalizeFallbackLocale(
  fallback: unknown,
  defaultLocale: string,
): Record<string, string[]> {
  if (typeof fallback === 'string') {
    return { default: [fallback] }
  }

  if (Array.isArray(fallback)) {
    return { default: (fallback as unknown[]).map(String) }
  }

  if (fallback && typeof fallback === 'object') {
    const result: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(fallback as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = value.map(String)
      }
      else if (typeof value === 'string') {
        result[key] = [value]
      }
    }
    return result
  }

  return { default: [defaultLocale] }
}
