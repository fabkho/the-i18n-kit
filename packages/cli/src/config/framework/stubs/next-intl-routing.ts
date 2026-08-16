/**
 * A stand-in for `next-intl/routing`, used only when the real package cannot
 * be resolved from the config file being read.
 *
 * `defineRouting` returns the object it is given, so a routing file's
 * `locales` and `defaultLocale` survive this substitution untouched — which is
 * the only reason it is safe. It exists so that reading a routing file does
 * not require the project's dependencies to be installed: a fresh clone, a CI
 * lint job, or a playground fixture has a `routing.ts` long before it has a
 * `node_modules`.
 *
 * The real package is preferred whenever it resolves. See `resolvableFrom` in
 * ../next.ts.
 */
export function defineRouting<T>(config: T): T {
  return config
}

export default defineRouting
