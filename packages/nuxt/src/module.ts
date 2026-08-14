import { defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export interface ModuleOptions {
  /**
   * Set to false to skip artifact generation entirely. The CLI then falls back
   * to adapter detection, exactly as it behaves without the module installed.
   */
  enabled?: boolean

  /**
   * Where the artifact is written, relative to the Nuxt build dir.
   * Only change this if something else already owns the default path.
   */
  artifact?: string
}

// Annotated rather than inferred: under pnpm's non-hoisted layout the inferred
// type cannot be named without pointing at a versioned @nuxt/schema path (TS2742).
const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@the-i18n-kit/nuxt',
    configKey: 'i18nKit',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: {
    enabled: true,
    artifact: 'i18n-kit.json',
  },
  setup(options) {
    if (!options.enabled) return

    // Artifact generation lands in #305. This package exists first so the
    // npm name, build tooling and release wiring are settled before there is
    // anything worth publishing.
  },
})

export default module
