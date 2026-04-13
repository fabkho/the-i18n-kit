import { log } from '../utils/logger'

type NuxtKit = typeof import('@nuxt/kit')

/**
 * Dynamically import a module from a given root directory.
 */
async function importModuleFrom(id: string, rootDir: string): Promise<unknown> {
  const { createRequire } = await import('node:module')
  const require = createRequire(rootDir + '/')
  const resolved = require.resolve(id)
  return import(resolved)
}

/**
 * Load @nuxt/kit from the project's own node_modules.
 * Falls back to trying common Nuxt package names.
 */
export async function loadKit(rootDir: string): Promise<NuxtKit> {
  try {
    const kit = await importModuleFrom('@nuxt/kit', rootDir) as NuxtKit
    log.debug(`Loaded @nuxt/kit from project: ${rootDir}`)
    return kit
  } catch (e: unknown) {
    const message = String(e)
    if (message.includes("Cannot find module '@nuxt/kit'")) {
      throw new Error(
        '@nuxt/kit is required for Nuxt projects but was not found. '
        + 'Install it with: npm install --save-dev @nuxt/kit\n'
        + 'Laravel projects do not need @nuxt/kit — if this is a Laravel project, '
        + 'check that your .i18n-mcp.json has "framework": "laravel" or that '
        + 'your project structure is detected correctly.',
      )
    }
    throw e
  }
}
