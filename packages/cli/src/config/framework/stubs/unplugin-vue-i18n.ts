/**
 * A stand-in for `@intlify/unplugin-vue-i18n` used only while reading a
 * project's `vite.config`.
 *
 * The real plugin keeps its `include` option in a closure — the object it
 * returns is all Vite hooks, no options — so executing the config teaches us
 * nothing unless the call itself is observed. This records the options and
 * hands back an inert plugin; the resolved Vite config is thrown away either
 * way, we are only here for that one value.
 *
 * Recorded on `globalThis` because jiti compiles this file into its own module
 * registry: a module-level variable here is not the same variable the CLI
 * would read. A registered symbol crosses that boundary.
 */
export const RECORDED = Symbol.for('the-i18n-kit:unplugin-vue-i18n-options')

function record(options?: unknown) {
  ;(globalThis as Record<symbol, unknown>)[RECORDED] = options
  return { name: 'the-i18n-kit:unplugin-vue-i18n-stub' }
}

export default record
export const vueI18n = record
export const unpluginVueI18n = record
