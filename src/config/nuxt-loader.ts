import { log } from '../utils/logger.js'

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
 * Try to resolve a module path from a given root directory.
 * Returns the resolved path, or null if not found.
 */
function tryResolveFrom(id: string, rootDir: string): string | null {
  try {
    const { createRequire } = require('node:module')
    const req = createRequire(rootDir + '/')
    return req.resolve(id)
  } catch {
    return null
  }
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
        'nuxt-i18n-mcp requires @nuxt/kit to be installed in your project. '
        + 'Make sure you have nuxt v3+ installed.',
      )
    }
    throw e
  }
}
