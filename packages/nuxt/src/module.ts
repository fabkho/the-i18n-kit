import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { addTemplate, defineNuxtModule, useLogger } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

import { version } from '../package.json'
import { buildArtifact } from './artifact'
import { checkOwnedKeys, checkProtectedLocales } from './validate'
import type { Diagnostic } from './validate'

const CONFIG_FILENAME = '.i18n-mcp.json'

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
    artifact: 'i18n-kit.json',
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

      const artifact = await buildArtifact({
        appDir: nuxt.options.rootDir,
        i18n,
        layers: nuxt.options._layers as unknown as Array<{ config: { rootDir: string, i18n?: Record<string, unknown> } }>,
        generator: `@the-i18n-kit/nuxt@${version}`,
      })

      const projectConfig = await readProjectConfig(nuxt.options.rootDir, logger)
      const diagnostics = [
        ...checkOwnedKeys(projectConfig),
        ...checkProtectedLocales(projectConfig?.protectedLocales as string[] | undefined, artifact.locales),
      ]

      report(diagnostics, logger, options.failOnInvalidConfig ?? true)

      // A template rather than a plain write: Nuxt owns the build dir, wipes it
      // during prepare and regenerates it in dev. Writing directly here races
      // that — the file lands and is then cleaned away before the build ends.
      addTemplate({
        filename: options.artifact ?? 'i18n-kit.json',
        write: true,
        getContents: () => `${JSON.stringify(artifact, null, 2)}\n`,
      })

      logger.success(
        `Published ${artifact.locales.length} locale(s) across ${artifact.layers.length} layer(s) `
        + `to ${join(nuxt.options.buildDir, options.artifact ?? 'i18n-kit.json')}`,
      )
    })
  },
})

export default module

interface LoggerLike {
  warn: (message: string) => void
  error: (message: string) => void
  success: (message: string) => void
}

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
      `${CONFIG_FILENAME} does not agree with your Nuxt config (${errors.length} problem(s), listed above). `
      + 'Set i18nKit.failOnInvalidConfig to false to report without failing.',
    )
  }
}

/**
 * Nearest `.i18n-mcp.json` walking up from the app, the same way the CLI finds
 * it — in a layered repo the config sits at the root while each app builds from
 * its own directory.
 */
async function readProjectConfig(
  startDir: string,
  logger: LoggerLike,
): Promise<Record<string, unknown> | null> {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME)
    if (existsSync(candidate)) {
      try {
        return JSON.parse(await readFile(candidate, 'utf-8')) as Record<string, unknown>
      }
      catch (error) {
        logger.warn(`Could not read ${candidate}: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
