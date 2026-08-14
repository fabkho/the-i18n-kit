/**
 * The half of the kit's config Nuxt cannot derive: what you tell it about your
 * project, rather than what it can see. Declaring it in `nuxt.config.ts` means
 * it is typed, autocompleted and checked at build time, next to the i18n config
 * it talks about.
 *
 * `.i18n-mcp.json` accepts all of it too, and still has to for non-Nuxt
 * projects. Declaring the same key in both is an error rather than a merge —
 * silent precedence between two sources is what this module exists to end.
 */
export interface I18nKitPolicy {
  /** Free-form project background handed to the translation model. */
  context?: string

  /** Term dictionary — brand names to leave alone, terms to keep consistent. */
  glossary?: Record<string, string>

  /** System prompt for translation requests. */
  translationPrompt?: string

  /** Per-locale guidance: formal register, regional variants, tone. */
  localeNotes?: Record<string, string>

  /** Few-shot translation examples. */
  examples?: Array<Record<string, string>>

  /** Rules for deciding which layer a new key belongs in. */
  layerRules?: Array<{ layer: string, description: string, when: string }>

  /**
   * Locales excluded from automatic translation. Address them by `code`: a ref
   * that matches nothing, or matches several locales, fails the build.
   */
  protectedLocales?: string[]

  /** Per-layer orphan-scan settings, keyed by layer name. */
  orphanScan?: Record<string, { ignorePatterns?: string[] }>

  /** Where diagnostic reports are written: true for `.i18n-reports/`, or a path. */
  reportOutput?: string | boolean

  /** Override the detected locale file format. */
  localeFileFormat?: 'json' | 'php-array'

  /** Base URL for the LLM provider — gateways, proxies, self-hosted servers. */
  providerBaseUrl?: string
}

const POLICY_KEYS = [
  'context',
  'glossary',
  'translationPrompt',
  'localeNotes',
  'examples',
  'layerRules',
  'protectedLocales',
  'orphanScan',
  'reportOutput',
  'localeFileFormat',
  'providerBaseUrl',
] as const

/** Everything declared in `nuxt.config.ts`, with the module's own knobs removed. */
export function readPolicy(options: Record<string, unknown>): I18nKitPolicy {
  const policy: Record<string, unknown> = {}
  for (const key of POLICY_KEYS) {
    if (options[key] !== undefined) policy[key] = options[key]
  }
  return policy as I18nKitPolicy
}

/**
 * Keys declared in both places. Neither wins: the caller reports them and
 * fails, because a reader cannot tell which one took effect.
 */
export function conflictingPolicyKeys(
  policy: I18nKitPolicy,
  fileConfig: Record<string, unknown> | null,
): string[] {
  if (!fileConfig) return []
  return POLICY_KEYS.filter(key => policy[key] !== undefined && fileConfig[key] !== undefined)
}
