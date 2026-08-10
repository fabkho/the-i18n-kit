/**
 * Helpers shared by the single-locale-dir adapters (react, vue).
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { I18nConfig, LocaleDefinition, ProjectConfig } from '../config/types'
import { ConfigError } from '../utils/errors'

const NUXT_CONFIG_FILES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']

export async function loadPackageJson(projectDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(projectDir, 'package.json'), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    return null
  }
}

export function collectDependencies(pkg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(pkg.dependencies ?? {}) as Record<string, unknown>,
    ...(pkg.devDependencies ?? {}) as Record<string, unknown>,
  }
}

export function hasNuxtConfig(dir: string): boolean {
  return NUXT_CONFIG_FILES.some(f => existsSync(join(dir, f)))
}

export function noLocaleDirError(projectDir: string, searchedDirs: string[]): ConfigError {
  return new ConfigError(
    `No locale directory found in ${projectDir}. `
    + 'Looked in: ' + searchedDirs.join(', ') + '. '
    + 'Configure a .i18n-mcp.json with localeDirs for custom paths.',
  )
}

/** Build the I18nConfig for a project with a single locale directory ('root' layer). */
export function buildSingleDirConfig(opts: {
  projectDir: string
  localeDir: string
  defaultLocale: string
  locales: LocaleDefinition[]
  projectConfig: ProjectConfig | null
}): I18nConfig {
  return {
    rootDir: opts.projectDir,
    defaultLocale: opts.defaultLocale,
    fallbackLocale: { default: [opts.defaultLocale] },
    locales: opts.locales,
    localeDirs: [{ path: opts.localeDir, layer: 'root', layerRootDir: opts.projectDir }],
    layerRootDirs: [opts.projectDir],
    projectConfig: opts.projectConfig ?? undefined,
    apps: [{ name: 'default', rootDir: opts.projectDir, layers: ['root'] }],
  }
}
