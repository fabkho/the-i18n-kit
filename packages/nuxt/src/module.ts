import { join } from 'node:path'
import { addTemplate, defineNuxtModule, useLogger } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

import { version } from '../package.json'
import { buildArtifact } from './artifact'
import { protectedLocalesFrom, readConfigSources } from './project-config'
import type { LoggerLike } from './project-config'
import { checkOwnedKeys, checkProtectedLocales } from './validate'
import type { Diagnostic } from './validate'

/**
 * Fixed, not configurable. The CLI looks for `<app>/.nuxt/i18n-kit.json` without
 * loading your Nuxt config — that is the point of the artifact — so it cannot
 * follow a renamed file. A configurable producer with a fixed consumer is a
 * setting that silently stops the two from meeting.
 *
 * The same reasoning applies to a custom `buildDir`: the CLI will not find the
 * artifact there and falls back to loading the app, as it does without this
 * module.
 */
const ARTIFACT_FILENAME = 'i18n-kit.json'

export interface ModuleOptions {
  /**
   * Set to false to skip artifact generation entirely. The CLI then falls back
   * to adapter detection, exactly as it behaves without the module installed.
   */
  enabled?: boolean

  /**
   * Report configuration problems without failing the build. The problems are
   * still printed — this only decides whether they stop you.
   */
  failOnInvalidConfig?: boolean
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@the-i18n-kit/nuxt',
    version,
    configKey: 'i18nKit',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: {
    enabled: true,
    failOnInvalidConfig: true,
  },
  setup(options, nuxt) {
    if (!options.enabled) return

    const logger = useLogger('i18n-kit')

    // modules:done, not setup: @nuxtjs/i18n normalises nuxt.options.i18n during
    // its own setup, and module order is not ours to assume. Reading it here
    // means reading what Nuxt resolved rather than what was typed.
    nuxt.hook('modules:done', async () => {
      // @nuxtjs/i18n augments NuxtOptions with its own `i18n` key when it is
      // installed. This module works without it installed, so the key is read
      // structurally rather than declared as a dependency on its types.
      const i18n = (nuxt.options as unknown as Record<string, unknown>).i18n as Record<string, unknown> | undefined

      if (!i18n) {
        logger.warn(
          'No i18n configuration found, so nothing was published. '
          + 'Install and configure @nuxtjs/i18n, or remove this module.',
        )
        return
      }

      const configSources = await readConfigSources(nuxt.options.rootDir, logger)

      const artifact = await buildArtifact({
        appDir: nuxt.options.rootDir,
        i18n,
        layers: nuxt.options._layers as unknown as Array<{ config: { rootDir: string, i18n?: Record<string, unknown> } }>,
        generator: `@the-i18n-kit/nuxt@${version}`,
      })

      // Checked against the locale table Nuxt actually resolved — the point of
      // validating here rather than at translate time.
      const diagnostics = [
        ...checkOwnedKeys(configSources),
        ...checkProtectedLocales(protectedLocalesFrom(configSources), artifact.locales),
      ]

      report(diagnostics, logger, options.failOnInvalidConfig ?? true)

      // Nothing to publish, and an empty table is worse than no artifact: the
      // CLI would have to decide whether it means "no locales" or "not built".
      if (artifact.locales.length === 0) {
        logger.warn(
          'No locales resolved from your i18n configuration, so nothing was published. '
          + 'The CLI will fall back to loading this app itself.',
        )
        return
      }

      // A template rather than a plain write: Nuxt owns the build dir, wipes it
      // during prepare and regenerates it in dev. Writing directly here races
      // that — the file lands and is then cleaned away before the build ends.
      addTemplate({
        filename: ARTIFACT_FILENAME,
        write: true,
        getContents: () => `${JSON.stringify(artifact, null, 2)}\n`,
      })

      logger.success(
        `Published ${artifact.locales.length} locale(s) across ${artifact.layers.length} layer(s) `
        + `to ${join(nuxt.options.buildDir, ARTIFACT_FILENAME)}`,
      )
    })
  },
})

export default module

function report(diagnostics: Diagnostic[], logger: LoggerLike, failOnInvalidConfig: boolean): void {
  const errors = diagnostics.filter(d => d.level === 'error')

  for (const diagnostic of diagnostics) {
    if (diagnostic.level === 'error') logger.error(diagnostic.message)
    else logger.warn(diagnostic.message)
  }

  // Failing the build is the whole point of checking at build time: a warning
  // to stderr is what let de-DE-formal protect nothing for months.
  if (errors.length > 0 && failOnInvalidConfig) {
    throw new Error(
      `Your i18n-kit configuration does not agree with your Nuxt config (${errors.length} problem(s), listed above). `
      + 'Set i18nKit.failOnInvalidConfig to false to report without failing.',
    )
  }
}
