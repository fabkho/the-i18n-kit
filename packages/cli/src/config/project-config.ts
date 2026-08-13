import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { z } from 'zod'
import type { ProjectConfig } from './types.js'
import { ConfigError, toErrorMessage } from '../utils/errors.js'
import { log } from '../utils/logger.js'

export const CONFIG_FILENAME = '.i18n-mcp.json'

// ─── Zod schema ─────────────────────────────────────────────────

const nonEmptyString = z.string().min(1).refine(s => s.trim().length > 0, 'Must not be empty or whitespace-only')

const layerRuleSchema = z.object({
  layer: z.string(),
  description: z.string(),
  when: z.string(),
})

const localeDirEntrySchema = z.union([
  nonEmptyString,
  z.object({
    path: nonEmptyString,
    layer: nonEmptyString,
  }),
])

const projectConfigSchema = z.object({
  $schema: z.string().optional(),
  framework: z.string().optional(),
  context: z.string().optional(),
  layerRules: z.array(layerRuleSchema).optional(),
  glossary: z.record(z.string(), z.string()).optional(),
  translationPrompt: z.string().optional(),
  localeNotes: z.record(z.string(), z.string()).optional(),
  examples: z.array(z.record(z.string(), z.string())).optional(),
  orphanScan: z.record(z.string(), z.object({
    ignorePatterns: z.array(z.string()).optional(),
  }).passthrough()).optional(), // passthrough for backwards-compat with deprecated keys like includeParentLayer
  localeDirs: z.array(localeDirEntrySchema).optional(),
  defaultLocale: z.string().optional(),
  locales: z.array(z.string()).optional(),
  protectedLocales: z.array(nonEmptyString).optional(),
  reportOutput: z.union([z.literal(true), nonEmptyString]).optional(),
  localeFileFormat: z.enum(['json', 'php-array']).optional(),
  providerBaseUrl: nonEmptyString.optional(),
  // Deprecated with the removal of MCP sampling: accepted so existing config
  // files keep validating (the schema is strict), warned about, and ignored.
  samplingPreferences: z.unknown().optional(),
}).strict()

/**
 * Validate a candidate project config against the published schema, returning
 * the formatted issue list rather than throwing. `init` uses this to refuse to
 * emit a config the tool would then reject; loadProjectConfig turns the same
 * failure into a ConfigError.
 */
export function validateProjectConfig(
  value: unknown,
): { ok: true; data: ProjectConfig } | { ok: false; error: string } {
  const result = projectConfigSchema.safeParse(value)
  if (result.success) return { ok: true, data: result.data as ProjectConfig }

  const error = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  ${path}: ${issue.message}`
    })
    .join('\n')
  return { ok: false, error }
}

// ─── Config file discovery ──────────────────────────────────────

/**
 * Walk up the directory tree from `startDir` to find the nearest config file.
 * Returns the full path if found, null otherwise.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = startDir
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break // filesystem root
    dir = parent
  }
  return null
}

/**
 * Load the optional project config file (.i18n-mcp.json).
 * Walks up from projectDir to find the nearest config file,
 * similar to how ESLint, Prettier, and tsconfig resolve configs.
 * Returns null if no config file is found in any ancestor.
 * Throws ConfigError if a file is found but is invalid.
 */
export async function loadProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  log.debug(`Searching for ${CONFIG_FILENAME} starting from: ${projectDir}`)

  const configPath = findConfigFile(projectDir)

  if (!configPath) {
    log.info(`No ${CONFIG_FILENAME} found in ${projectDir} or any parent directory — skipping`)
    return null
  }

  log.info(`Found project config: ${configPath}`)

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    throw new ConfigError(
      `Failed to read ${CONFIG_FILENAME}: ${toErrorMessage(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ConfigError(
      `Invalid JSON in ${CONFIG_FILENAME}: ${toErrorMessage(error)}`,
    )
  }

  const result = validateProjectConfig(parsed)

  if (!result.ok) {
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}:\n${result.error}`)
  }

  log.debug(`Project config loaded successfully from ${configPath}`)

  const data = result.data as ProjectConfig & { samplingPreferences?: unknown }
  if ('samplingPreferences' in data) {
    log.warn(
      `${CONFIG_FILENAME}: "samplingPreferences" is deprecated and ignored — `
      + 'MCP sampling was removed. Configure a provider (e.g. I18N_PROVIDER/I18N_MODEL) instead.',
    )
    delete data.samplingPreferences
  }

  return data
}
