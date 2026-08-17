import type { ArtifactLocale } from './artifact'
import type { ConfigSource } from './project-config'

/**
 * Same precedence the CLI resolves with (#301): an exact `code` outranks a
 * `language` tag, which outranks a `file` name. Codes are unique by
 * construction; language tags are not — two locales can both declare `de-DE`.
 */
const MATCH_FIELDS = ['code', 'language', 'file'] as const
type MatchField = typeof MATCH_FIELDS[number]

/** Keys Nuxt already answers. Declaring them again is a second source of truth. */
const MODULE_OWNED_KEYS = ['locales', 'localeDirs', 'defaultLocale'] as const

export interface Diagnostic {
  level: 'error' | 'warn'
  message: string
}

interface Match {
  field: MatchField
  candidates: ArtifactLocale[]
}

function match(locales: ArtifactLocale[], ref: string): Match | undefined {
  for (const field of MATCH_FIELDS) {
    const candidates = locales.filter(locale => locale[field] === ref)
    if (candidates.length > 0) return { field, candidates }
  }
  return undefined
}

/**
 * Check `protectedLocales` against the locale table Nuxt actually resolved.
 *
 * This is the check that would have caught `de-DE-formal` on the day it was
 * written: it matches no locale, so the CLI warned to stderr and carried on,
 * and formal German sat in the machine-translation target list for months
 * while appearing protected.
 */
export function checkProtectedLocales(
  protectedLocales: string[] | undefined,
  locales: ArtifactLocale[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  // "Available codes: " with nothing after it reads as a broken message rather
  // than as the finding it is — that no locales resolved at all.
  const available = locales.length > 0
    ? `Available codes: ${locales.map(l => l.code).join(', ')}`
    : 'No locales resolved from your i18n configuration at all.'

  for (const ref of protectedLocales ?? []) {
    const found = match(locales, ref)

    if (!found) {
      diagnostics.push({
        level: 'error',
        message: `protectedLocales: "${ref}" matches no locale, so it protects nothing. ${available}`,
      })
      continue
    }

    if (found.candidates.length > 1) {
      diagnostics.push({
        level: 'error',
        message: `protectedLocales: "${ref}" is ambiguous — it matches ${found.candidates.length} locales `
          + `by ${found.field} (${found.candidates.map(c => c.code).join(', ')}). Use one of those codes instead.`,
      })
      continue
    }

    // Unambiguous today, but only because no second locale declares this tag
    // yet. The failure mode is silent: adding one turns this ref ambiguous
    // without touching the line that wrote it.
    const [only] = found.candidates
    if (found.field !== 'code' && only) {
      diagnostics.push({
        level: 'warn',
        message: `protectedLocales: "${ref}" matched by ${found.field} rather than code. `
          + `Prefer "${only.code}" — a locale added later with the same ${found.field} would make this ambiguous.`,
      })
    }
  }

  return diagnostics
}

/**
 * Keys the module derives must not also be declared by hand. Silent precedence
 * between the two is how the drift this module exists to remove began.
 *
 * Every hand-written source is checked, not just the JSON one: the typed config
 * is the recommended place to declare things, so checking only `.i18n-mcp.json`
 * left the file people are steered towards as the one that could conflict in
 * silence (#362).
 */
export function checkOwnedKeys(sources: ConfigSource[]): Diagnostic[] {
  return sources.flatMap(source =>
    MODULE_OWNED_KEYS
      .filter(key => source.config[key] !== undefined)
      .map(key => ({
        level: 'error' as const,
        message: `${source.path} declares "${key}", which this module derives from your Nuxt config. `
          + `Remove it — keeping both means two sources of truth and no way to tell which won.`,
      })),
  )
}
