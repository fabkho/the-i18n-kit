/**
 * The one definition of the declared half of the kit's configuration —
 * everything a human tells the tool, as opposed to what it can see for itself.
 *
 * `.i18n-mcp.json`, `i18n-kit.config.ts` and the `i18nKit` block in
 * `nuxt.config.ts` all accept this same shape, and all validate against this
 * same schema. The `ProjectConfig` interface in `./types.ts` documents it;
 * the guard at the bottom of this file fails the build if the two drift.
 */
import { z } from 'zod'
import type { ProjectConfig } from './types.js'
import { log } from '../utils/logger.js'

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
  defaultLocale: nonEmptyString.optional(),
  locales: z.array(nonEmptyString).optional(),
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
 * emit a config the tool would then reject; the loaders turn the same failure
 * into a ConfigError naming the file it came from.
 */
export function validateProjectConfig(
  value: unknown,
): { ok: true, data: ProjectConfig } | { ok: false, error: string } {
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

/**
 * Strip the deprecated keys the schema still accepts, warning once, so that a
 * config keeps validating without the value going on to mean anything. Applied
 * by every loader — a key ignored in `.i18n-mcp.json` but silently honoured in
 * `i18n-kit.config.ts` would be exactly the divergence this file exists to
 * prevent.
 */
export function dropDeprecatedKeys(config: ProjectConfig, source: string): ProjectConfig {
  const data = config as ProjectConfig & { samplingPreferences?: unknown }
  if ('samplingPreferences' in data) {
    log.warn(
      `${source}: "samplingPreferences" is deprecated and ignored — `
      + 'MCP sampling was removed. Configure a provider (e.g. I18N_PROVIDER/I18N_MODEL) instead.',
    )
    delete data.samplingPreferences
  }
  return data
}

// ─── Drift guard ────────────────────────────────────────────────
//
// A key added to the interface but not the schema is rejected at runtime as an
// unknown key (the schema is strict) — a typed config that the editor accepts
// and the CLI refuses. A key added to the schema but not the interface is
// accepted at runtime and invisible in an editor. Both are the drift this
// module exists to prevent, so both are a type error here.
//
// `$schema` is JSON-only, and `samplingPreferences` is accepted purely so old
// files keep validating; neither belongs in the documented type.

type SchemaKey = Exclude<keyof z.infer<typeof projectConfigSchema>, '$schema' | 'samplingPreferences'>

/** Fails to compile unless `T` is `never`, naming the offending key when not. */
type NoDrift<T extends never> = T

type _SchemaCoversType = NoDrift<Exclude<keyof ProjectConfig, SchemaKey>>
type _TypeCoversSchema = NoDrift<Exclude<SchemaKey, keyof ProjectConfig>>
