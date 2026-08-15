/**
 * Executing config files that belong to *other* tools.
 *
 * Where a project already declares its locales authoritatively — next-intl's
 * `defineRouting`, next-translate's `i18n.js`, `next.config`'s `i18n` block —
 * reading it beats guessing from directory order. The only reason the adapters
 * ever guessed is that the CLI could not run TypeScript.
 *
 * The rule for everything in here: **never load-bearing**. A real
 * `next.config.js` is wrapped in `withNextIntl(...)` or `withSentryConfig(...)`
 * and throws without the right env or plugins installed. A file we cannot run
 * means falling back to the heuristics that were the only behaviour until now,
 * with a warning — never a failed command. This is the rule `config/artifact.ts`
 * already follows for the Nuxt artifact, for the same reason.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { toErrorMessage } from '../../utils/errors.js'
import { log } from '../../utils/logger.js'

/**
 * Run one config file and hand back its exports, or null if anything at all
 * went wrong. Callers treat null as "no information", not as an error.
 */
export async function executeConfig(
  path: string,
  options: { alias?: Record<string, string> } = {},
): Promise<Record<string, unknown> | null> {
  try {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(import.meta.url, {
      interopDefault: false,
      ...(options.alias ? { alias: options.alias } : {}),
    })
    const module = await jiti.import(path)
    return module && typeof module === 'object' ? module as Record<string, unknown> : null
  }
  catch (error) {
    log.warn(
      `Could not read ${path}: ${toErrorMessage(error)}. `
      + 'Falling back to directory detection — declare the value in i18n-kit.config.ts to be sure of it.',
    )
    return null
  }
}

/** The first of `candidates` that exists under `projectDir`, as a full path. */
export function firstExisting(projectDir: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const path = join(projectDir, candidate)
    if (existsSync(path)) return path
  }
  return null
}

/** A module's default export, or the module itself for a CJS `module.exports`. */
export function defaultExport(module: Record<string, unknown>): unknown {
  return 'default' in module ? module.default : module
}

/** Narrow an unknown to a plain object, the shape every reader here digs into. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** A non-empty string, or undefined — config values are not to be trusted. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** An array of non-empty strings, or undefined. */
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return strings.length > 0 ? strings : undefined
}
