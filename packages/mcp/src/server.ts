import { createRequire } from 'node:module'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import type { CacheHint } from '@modelcontextprotocol/server'
import { z } from 'zod'

const require = createRequire(import.meta.url)
const { name: packageName, version } = require('../package.json') as { name: string, version: string }

import {
  detectI18nConfig,
  getCachedConfig,
  readLocaleData,
  ToolError,
  renameNotice,
  detectConfig,
  listLocaleDirs,
  serializeLayerGraph,
  getTranslations,
  writeTranslations,
  getMissingTranslations,
  findEmptyTranslations,
  getTranslationStatus,
  searchTranslations,
  removeTranslations,
  renameTranslationKey,
  translateMissing,
  translateKey,
  findOrphanKeys,
  removeOrphanKeys,
  findDuplicateKeys,
  checkUndefinedKeys,
  scaffoldLocaleFiles,
  listNamespaces,
  findLocaleImpl,
  resolveProtectedLocales,
  toErrorMessage,
  createTranslateFn,
  resolveProviderBaseUrl,
  loadProjectConfig,
  BASE_URL_ENV,
} from 'the-i18n-cli'

import type { TranslateFn, ProgressFn, ProjectConfig, LlmProvider } from 'the-i18n-cli'

// Every tool, resource, and prompt handler must default projectDir to this —
// falling through to core's own process.cwd() default would ignore
// I18N_PROJECT_DIR (the documented env contract).
const DEFAULT_PROJECT_DIR = process.env.I18N_PROJECT_DIR ?? process.cwd()

// ─── Translation backend (resolved once at startup) ───────────────

const PROVIDER_KEY_ENVS: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
}

interface TranslationBackend {
  mode: 'provider' | 'agent'
  provider?: LlmProvider
  model?: string
  translateFn?: TranslateFn
}

function isKnownProvider(value: string): value is LlmProvider {
  return value in PROVIDER_KEY_ENVS
}

/**
 * Resolve the translation backend from environment configuration.
 *
 * Fully configured (`I18N_PROVIDER`, `I18N_MODEL`, and the provider's API key
 * env) → provider mode: translate tools call the LLM provider directly.
 * Nothing configured → agent mode: translate tools return fallback contexts
 * for the host agent to translate inline and persist via write_translations.
 * Partial configuration → a startup warning on stderr plus agent mode, so a
 * misconfigured server never surprises callers per-request.
 */
async function resolveTranslationBackend(): Promise<TranslationBackend> {
  const provider = process.env.I18N_PROVIDER
  const model = process.env.I18N_MODEL

  if (!provider && !model) return { mode: 'agent' }

  const warn = (message: string) => process.stderr.write(`[the-i18n-mcp] ${message}\n`)

  if (!provider) {
    warn('Partial provider config: I18N_MODEL is set but I18N_PROVIDER is missing. Running in agent mode.')
    return { mode: 'agent' }
  }
  if (!isKnownProvider(provider)) {
    warn(`Partial provider config: I18N_PROVIDER="${provider}" is not one of openai | anthropic | google. Running in agent mode.`)
    return { mode: 'agent' }
  }
  if (!model) {
    warn(`Partial provider config: I18N_PROVIDER=${provider} is set but I18N_MODEL is missing. Running in agent mode.`)
    return { mode: 'agent' }
  }
  const keyEnv = PROVIDER_KEY_ENVS[provider]
  if (!process.env[keyEnv]) {
    warn(`Partial provider config: I18N_PROVIDER=${provider} is set but ${keyEnv} is missing. Running in agent mode.`)
    return { mode: 'agent' }
  }

  try {
    const translateFn = await createTranslateFn({ provider, model, baseUrl: await resolveStartupBaseUrl() })
    return { mode: 'provider', provider, model, translateFn }
  } catch (error) {
    warn(`Provider setup failed: ${toErrorMessage(error)}. Running in agent mode.`)
    return { mode: 'agent' }
  }
}

/**
 * Base URL for the startup-resolved backend: I18N_BASE_URL, else the project
 * config's providerBaseUrl. A missing or unreadable config is not fatal here
 * — the server still starts, just without an endpoint override.
 */
async function resolveStartupBaseUrl(): Promise<string | undefined> {
  const fromEnv = resolveProviderBaseUrl({ env: process.env[BASE_URL_ENV] })
  if (fromEnv) return fromEnv
  try {
    const projectConfig = await loadProjectConfig(DEFAULT_PROJECT_DIR)
    return resolveProviderBaseUrl({ config: projectConfig?.providerBaseUrl })
  } catch {
    return undefined
  }
}

// ─── Shared helpers ───────────────────────────────────────────────

function buildProjectConfigSection(pc: ProjectConfig | undefined): string {
  if (!pc) return ''
  let s = ''
  if (pc.context) s += `\nPROJECT CONTEXT: ${pc.context}\n`
  if (pc.layerRules?.length) {
    s += '\nLAYER RULES:\n'
    for (const rule of pc.layerRules) {
      s += `- ${rule.layer}: ${rule.description} (when: ${rule.when})\n`
    }
  }
  if (pc.glossary && Object.keys(pc.glossary).length > 0) {
    s += '\nGLOSSARY:\n'
    for (const [term, definition] of Object.entries(pc.glossary)) {
      s += `- ${term} → ${definition}\n`
    }
  }
  if (pc.translationPrompt) s += `\nTRANSLATION STYLE: ${pc.translationPrompt}\n`
  if (pc.localeNotes && Object.keys(pc.localeNotes).length > 0) {
    s += '\nLOCALE NOTES:\n'
    for (const [locale, note] of Object.entries(pc.localeNotes)) {
      s += `- ${locale}: ${note}\n`
    }
  }
  if (pc.examples?.length) {
    s += '\nEXAMPLES:\n'
    for (const ex of pc.examples) {
      const pairs = Object.entries(ex)
        .filter(([k]) => k !== 'key' && k !== 'note')
        .map(([locale, val]) => `${locale}: "${val}"`)
        .join(', ')
      s += `- ${ex.key}: ${pairs}${ex.note ? ` (${ex.note})` : ''}\n`
    }
  }
  return s
}

/**
 * Format a caught error into an MCP tool error response.
 */
function toolErrorResponse(context: string, error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: error instanceof ToolError
          ? `[${error.code}] ${error.message}`
          : `Error ${context}: ${toErrorMessage(error)}`,
      },
    ],
    isError: true,
  }
}

/**
 * The rename notice (#315), or null when running under the new name.
 *
 * An editor spawns this server through `npx`, so an install-time deprecation
 * is printed into a stream nobody reads and the agent using the tools never
 * learns the package moved. It has to reach the model at runtime instead.
 */
const RENAME_NOTICE = renameNotice(packageName)

/**
 * Wrap a plain result object as MCP text content, delivering the rename notice
 * on the first result this server produces.
 *
 * Built per server rather than shared: with the flag at module scope, two
 * servers in one process race for a single delivery and whichever called
 * second never announced itself at all.
 *
 * Once, not per call. Repeating it would cost context on every response and
 * teach the model to skip it — the opposite of what a notice is for.
 */
function createJsonContent() {
  let noticeDelivered = false

  return function jsonContent(data: unknown) {
    let payload = data

    if (RENAME_NOTICE && !noticeDelivered && payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
      noticeDelivered = true
      payload = { ...payload, _notice: RENAME_NOTICE }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    }
  }
}

// Shared input-schema fragments (identical wording across tools).
const projectDirInput = () => z
  .string()
  .optional()
  .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".')

const outputFileInput = (example: string) => z
  .string()
  .optional()
  .describe(`Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "${example}"`)

// SEP-2549 cache hints for the cacheable 2026-07-28 results.
const STATIC_SURFACE_CACHE: CacheHint = { ttlMs: 3_600_000, cacheScope: 'private' }

export interface CreateServerOptions {
  /**
   * Test-only seam: inject a TranslateFn directly, bypassing environment
   * resolution. Production callers must leave this unset and configure the
   * backend via I18N_PROVIDER / I18N_MODEL / the provider's API key env.
   */
  translateFn?: TranslateFn
}

/**
 * Create and configure the MCP server with all tools.
 *
 * The translation backend is resolved once here, at startup — see
 * resolveTranslationBackend for the environment contract.
 */
export async function createServer(options: CreateServerOptions = {}): Promise<McpServer> {
  const backend: TranslationBackend = options.translateFn
    ? { mode: 'provider', translateFn: options.translateFn }
    : await resolveTranslationBackend()

  const jsonContent = createJsonContent()

  const server = new McpServer(
    {
      name: 'the-i18n-mcp',
      version,
    },
    {
      ...(RENAME_NOTICE ? { instructions: RENAME_NOTICE } : {}),
      // 2026-07-28 responses only — legacy-era responses never carry cache
      // fields. Everything is 'private': locale data is project-local.
      cacheHints: {
        // Tool/prompt registrations and the discover advertisement are fixed
        // for the process lifetime.
        'tools/list': STATIC_SURFACE_CACHE,
        'prompts/list': STATIC_SURFACE_CACHE,
        'server/discover': STATIC_SURFACE_CACHE,
        // Resources carry no cache hints: the write tools mutate locale
        // files and clients have no guaranteed invalidation channel, so any
        // TTL would let an agent read stale data right after its own write.
      },
    },
  )

  // ─── Tool: discover ────────────────────────────────────────────

  server.registerTool(
    'discover',
    {
      title: 'Discover i18n Setup',
      description:
        'Discover the complete i18n setup. Returns project config (locales, default locale, layers, '
        + 'fallback chain, glossary, translation style) plus per-layer directory listings with file '
        + 'counts and top-level key namespaces, and the active translation mode ("provider" when the '
        + 'server has an env-configured LLM provider, "agent" otherwise). Call this first to '
        + 'understand the project before reading or writing translations. layerGraph answers where a '
        + 'new key belongs: a key used by more than one app belongs in a layer those apps share, and '
        + 'layerGraph.shared names those layers.',
      inputSchema: z.object({
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Defaults to I18N_PROJECT_DIR, then server cwd.'),
      }),
    },
    async ({ projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        // detectConfig first: it warms the config cache listLocaleDirs reuses
        const config = await detectConfig(projectDir)
        const dirs = await listLocaleDirs(projectDir)
        return jsonContent({
          ...config,
          // Resolved canonical codes of human-maintained locales that the
          // translate tools exclude from default targets (raw refs live in
          // projectConfig.protectedLocales).
          protectedLocales: resolveProtectedLocales(config).map(l => l.code),
          layers: dirs,
          // The topology behind that flat list: which layers are shared, which
          // apps consume which layer, and what each alias points at. Without it
          // an agent placing a key can only guess from layer names, which is
          // how app-layer keys end up duplicating root keys (#342).
          layerGraph: serializeLayerGraph(config),
          // Active translation mode — lets operators verify env configuration
          // without triggering a translation. Never includes the API key.
          translationMode: backend.mode,
          ...(backend.provider ? { translationProvider: backend.provider } : {}),
          ...(backend.model ? { translationModel: backend.model } : {}),
        })
      } catch (error) {
        return toolErrorResponse('discovering i18n setup', error)
      }
    },
  )

  // ─── Tool: list_namespaces ─────────────────────────────────────

  server.registerTool(
    'list_namespaces',
    {
      title: 'List Namespaces',
      description:
        'List the translation key tree grouped by namespace prefix. '
        + 'Returns a hierarchical view of all keys with counts per namespace node. '
        + 'Use this to explore available keys without guessing path prefixes.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to filter by (e.g., "root", "app-admin"). If omitted or "*", scans all layers. Call discover to discover available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale to read keys from (e.g., "en"). Defaults to the project default locale. Keys are the same across locales — only one is needed.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, locale, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await listNamespaces({ layer, locale, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('listing namespaces', error)
      }
    },
  )

  // ─── Tool: find_empty_translations ─────────────────────────────

  server.registerTool(
    'find_empty_translations',
    {
      title: 'Find Empty Translations',
      description:
        'Find keys whose value is an empty string. '
        + 'These exist in the locale file, so they are not reported as missing, and they render as nothing in the UI. '
        + 'Use this after a scaffold or an interrupted translation run to find keys that were created but never filled.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to filter by (e.g., "root", "app-admin"). If omitted, checks all layers. Call discover to discover available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale to check (e.g., "de"). If omitted, checks every locale.'),
        projectDir: projectDirInput(),
        outputFile: outputFileInput('/tmp/empty-translations.json'),
      }),
    },
    async ({ layer, locale, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await findEmptyTranslations({ layer, locale, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding empty translations', error)
      }
    },
  )

  // ─── Tool: get_translations ────────────────────────────────────

  server.registerTool(
    'get_translations',
    {
      title: 'Get Translations',
      description:
        'Get translation values for given key paths from a specific locale and layer. Use "*" as locale to read from all locales.',
      inputSchema: z.object({
        layer: z
          .string()
          .describe('Layer name from discover (e.g., "root", "app-admin"). Call discover to discover available layers.'),
        locale: z
          .string()
          .describe('Locale code, locale file name, or "*" to read all locales. Examples: "en", "en-US", "en-US.json", "*".'),
        compact: z
          .boolean()
          .optional()
          .describe('When true and locale is "*", returns a compact summary grouped by key instead of per-locale detail. Default: false.'),
        keys: z
          .array(z.string())
          .describe('Dot-separated key paths to read. Example: ["common.actions.save", "auth.login.title"].'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, locale, keys, compact, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await getTranslations({ layer, locale, keys, compact, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('getting translations', error)
      }
    },
  )

  // ─── Tool: write_translations ──────────────────────────────────

  server.registerTool(
    'write_translations',
    {
      title: 'Write Translations',
      description:
        'Write translation key-value pairs to a layer. '
        + 'Mode "upsert" adds new keys and updates existing ones (default, most common). '
        + 'Mode "add" only creates new keys, skipping existing ones. '
        + 'Mode "update" only modifies existing keys, skipping missing ones. '
        + 'Keys are inserted in alphabetical order. Use dryRun to preview without writing.',
      inputSchema: z.object({
        layer: z
          .string()
          .describe('Layer name (e.g., "root", "app-admin"). Discover layers via the discover tool.'),
        translations: z
          .record(
            z.string().describe('Dot-separated key path, e.g. "auth.login.title"'),
            z.record(
              z.string().describe('Locale code or file name, e.g. "en", "en-US", "en-US.json"'),
              z.string().describe('Translation string value for this locale'),
            ),
          )
          .describe('Map of dot-path keys to locale-value pairs. IMPORTANT: values must be locale maps, NOT plain strings. Locale refs may be code ("en-us"), language ("en-US"), or file ("en-US.json"). Wrong: { "auth.failed": "Login failed" }. Correct: { "auth.failed": { "en-US": "Login failed", "de-DE": "Anmeldung fehlgeschlagen" } }'),
        mode: z
          .enum(['add', 'update', 'upsert'])
          .optional()
          .describe('Write mode. "upsert": add-or-update (never fails). "add": only new keys. "update": only existing keys. Default: "upsert".'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns a preview of what would be written without writing any files. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, translations, mode, dryRun, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await writeTranslations({ layer, translations, mode, dryRun, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('writing translations', error)
      }
    },
  )

  // ─── Tool: get_missing_translations ────────────────────────────

  server.registerTool(
    'get_missing_translations',
    {
      title: 'Get Missing Translations',
      description:
        'Find translation keys that exist in the reference locale but are missing in other locales. Scans a specific layer or all layers.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to scan (e.g., "root", "app-admin"). If omitted, scans all layers. Call discover to discover available layers.'),
        referenceLocale: z
          .string()
          .optional()
          .describe('Locale code used as the source of truth (e.g., "en", "en-US"). Defaults to the project default locale.'),
        targetLocales: z
          .array(z.string())
          .optional()
          .describe('Locale codes to check for missing keys (e.g., ["de", "fr", "es"]). Defaults to all locales except the reference.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/missing-translations.json"'),
      }),
    },
    async ({ layer, referenceLocale, targetLocales, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await getMissingTranslations({ layer, referenceLocale, targetLocales, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding missing translations', error)
      }
    },
  )

  // ─── Tool: get_translation_status ──────────────────────────────

  server.registerTool(
    'get_translation_status',
    {
      title: 'Get Translation Status',
      description:
        'Translation coverage in one call: per-locale and per-layer counts of total, translated, missing and empty keys, plus an overall completion percentage. Use this instead of calling get_missing_translations per layer and counting keys yourself. Empty-string values count as untranslated. Locales listed in protectedLocales are reported but excluded from the overall figure, since they are maintained by hand.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to scan (e.g., "root", "app-admin"). If omitted, scans all layers.'),
        referenceLocale: z
          .string()
          .optional()
          .describe('Locale code used as the source of truth (e.g., "en", "en-US"). Defaults to the project default locale.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Defaults to I18N_PROJECT_DIR, then server cwd.'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write the full per-locale and per-layer breakdown. Returns only the summary to the caller.'),
      }),
    },
    async ({ layer, referenceLocale, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await getTranslationStatus({ layer, referenceLocale, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('reading translation status', error)
      }
    },
  )

  // ─── Tool: search_translations ─────────────────────────────────

  server.registerTool(
    'search_translations',
    {
      title: 'Search Translations',
      description:
        'Search translation files by key path or value. Simple case-insensitive substring match — not fuzzy or regex. Useful for finding existing translations before adding duplicates.',
      inputSchema: z.object({
        query: z
          .string()
          .describe('Substring to search for. Matched against translation keys and/or string values. Case-insensitive. Example: "save" matches key "common.actions.save" or value "Save changes".'),
        searchIn: z
          .enum(['keys', 'values', 'both'])
          .optional()
          .describe('Whether to search in translation keys, values, or both. Default: "both".'),
        layer: z
          .string()
          .optional()
          .describe('Layer name to search in (e.g., "root", "app-admin"), or "*" for all layers. If omitted, searches all layers. Call discover to discover available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale code to search in (e.g., "en", "de"). If omitted, searches all locales.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/search-results.json"'),
      }),
    },
    async ({ query, searchIn, layer, locale, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await searchTranslations({ query, searchIn, layer, locale, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('searching translations', error)
      }
    },
  )

  // ─── Tool: remove_translations ─────────────────────────────────

  server.registerTool(
    'remove_translations',
    {
      title: 'Remove Translations',
      description:
        'Remove one or more translation keys from ALL locale files in the specified layer. Use dryRun to preview changes before applying them.',
      inputSchema: z.object({
        layer: z
          .string()
          .describe('Layer name from discover (e.g., "root", "app-admin"). The key will be removed from ALL locale files in this layer.'),
        keys: z
          .array(z.string())
          .describe('Dot-separated key paths to remove from every locale file in the layer. Example: ["common.actions.delete", "auth.errors.expired"].'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns a preview of what would be removed without writing any files. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, keys, dryRun, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await removeTranslations({ layer, keys, dryRun, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('removing translations', error)
      }
    },
  )

  // ─── Tool: rename_translation_key ──────────────────────────────

  server.registerTool(
    'rename_translation_key',
    {
      title: 'Rename Translation Key',
      description:
        'Rename/move a translation key across ALL locale files in a layer. Preserves the value in every locale. Use dryRun to preview changes before applying them.',
      inputSchema: z.object({
        layer: z
          .string()
          .describe('Layer name from discover (e.g., "root", "app-admin"). The key will be renamed in ALL locale files in this layer.'),
        oldKey: z
          .string()
          .describe('Current dot-separated key path to rename. Example: "common.actions.save".'),
        newKey: z
          .string()
          .describe('New dot-separated key path after renaming. Example: "common.buttons.save". Must not already exist.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns a preview of what would be renamed without writing any files. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, oldKey, newKey, dryRun, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await renameTranslationKey({ layer, oldKey, newKey, dryRun, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('renaming translation key', error)
      }
    },
  )

  // ─── Tool: translate_missing ───────────────────────────────────

  server.registerTool(
    'translate_missing',
    {
      title: 'Translate Missing',
      description:
        'Find keys missing in target locales and translate them. Two modes: in provider mode (server env-configured with I18N_PROVIDER, I18N_MODEL, and an API key) the server calls the LLM provider directly and writes the results; in agent mode (no provider configured) it returns per-locale fallbackContexts — translate those inline and persist via write_translations. Check the discover output for the active mode. Uses project config (glossary, translation prompt, locale notes, examples) if available. Translates all locales concurrently by default — pass all targetLocales at once.',
      annotations: {
        title: 'Translate Missing Translations',
        readOnlyHint: false,
      },
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name from discover to translate (e.g., "root", "app-admin"). Omit to translate every locale-backed layer in one call — the recommended default for layered projects, which returns a result per layer plus an aggregated summary.'),
        referenceLocale: z
          .string()
          .optional()
          .describe('Locale code used as translation source (e.g., "en", "en-US"). Defaults to the project default locale.'),
        targetLocales: z
          .array(z.string())
          .optional()
          .describe('Locale codes to translate into (e.g., ["de", "fr", "sv"]). Defaults to all locales except the reference.'),
        keys: z
          .array(z.string())
          .optional()
          .describe('Specific dot-path keys to translate (e.g., ["auth.login.title", "common.save"]). If omitted, translates all missing keys in the layer.'),
        batchSize: z
          .number()
          .optional()
          .describe('Max keys per provider request (provider mode only). Default: 50. Lower values reduce per-batch risk but increase round trips.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns which keys would be translated without calling the LLM or writing files. Default: false.'),
        compact: z
          .boolean()
          .optional()
          .describe('When true, returns a compact summary (totalTranslated, totalFailed, byLocale) instead of full per-locale results. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ layer, referenceLocale, targetLocales, keys, batchSize, dryRun, compact, projectDir = DEFAULT_PROJECT_DIR }, ctx) => {
      try {
        // Invariant: translateMissing invokes onProgressTotal during its
        // pre-scan, before the first progressFn call — progressTotal is
        // always set by the time a notification is sent.
        const progressToken = ctx.mcpReq._meta?.progressToken
        let progressCurrent = 0
        let progressTotal: number | undefined
        const progressFn: ProgressFn = async (message: string) => {
          if (progressToken === undefined) return
          progressCurrent++
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: progressCurrent,
              total: progressTotal,
              message,
            },
          })
        }

        const result = await translateMissing({
          layer,
          referenceLocale,
          targetLocales,
          keys,
          batchSize,
          dryRun,
          compact,
          projectDir,
          translateFn: backend.translateFn,
          progressFn,
          onProgressTotal: (total) => { progressTotal = total },
        })

        // MCP-owned guidance for agent mode. All-layers mode (no `layer`
        // argument, the default for layered projects since #292) nests the
        // fallback contexts per layer, so checking only the top level would
        // skip the guidance in exactly the case an agent is most likely to hit.
        const hasFallbacks = 'layers' in result
          ? Object.values(result.layers).some(l => l.fallbackContexts)
          : Boolean(result.fallbackContexts)

        if (hasFallbacks && result.summary) {
          (result.summary as Record<string, unknown>).message
            = 'Agent mode — no provider configured on the server. Use the fallbackContexts to translate '
            + 'inline, then call write_translations (mode: "upsert") to write the results. To enable '
            + 'provider mode, set I18N_PROVIDER, I18N_MODEL, and the provider API key env on the server process.'
        }

        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('translating missing keys', error)
      }
    },
  )

  // ─── Tool: translate_key ──────────────────────────────────────

  server.registerTool(
    'translate_key',
    {
      title: 'Translate Key',
      description:
        'Add/update one source translation key and translate it into target locales. Unlike translate_missing, this can overwrite existing stale target translations. Same two modes as translate_missing: provider mode (server env-configured) translates directly; agent mode returns a fallbackContext — translate it inline and persist via write_translations.',
      annotations: {
        title: 'Translate Single Key',
        readOnlyHint: false,
      },
      inputSchema: z.object({
        layer: z
          .string()
          .describe('Layer name from discover to update (e.g., "root", "app-admin").'),
        key: z
          .string()
          .describe('Dot-separated key path to translate. Example: "bookingCreator.options.removeSubResource".'),
        sourceLocale: z
          .string()
          .describe('Source locale ref. May be code ("en-us"), language ("en-US"), or file ("en-US.json").'),
        sourceValue: z
          .string()
          .optional()
          .describe('Optional source value. If provided, source locale is added/updated before translating. If omitted, existing source value is read.'),
        targetLocales: z
          .union([z.literal('all'), z.array(z.string())])
          .optional()
          .describe('Target locales to translate into. Use "all" or omit for all locales except source.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('When true, overwrite existing target translations. When false, only fill missing targets. Default: true.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, previews source/target locales without writing files or calling the translation backend.'),
        includePreview: z
          .boolean()
          .optional()
          .describe('When true, include translated values in output. Default false to keep responses compact.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd.'),
      }),
    },
    async ({ layer, key, sourceLocale, sourceValue, targetLocales, overwrite, dryRun, includePreview, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await translateKey({
          layer,
          key,
          sourceLocale,
          sourceValue,
          targetLocales,
          overwrite,
          dryRun,
          includePreview,
          projectDir,
          translateFn: backend.translateFn,
        })

        // MCP-owned guidance for agent mode
        if (result.fallbackContext) {
          result.message = 'Agent mode — no provider configured on the server. Use the fallbackContext to '
            + 'translate inline, then call write_translations (mode: "upsert") to write the results. To enable '
            + 'provider mode, set I18N_PROVIDER, I18N_MODEL, and the provider API key env on the server process.'
        }

        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('translating key', error)
      }
    },
  )

  // ─── Tool: find_orphan_keys ───────────────────────────────────

  server.registerTool(
    'find_orphan_keys',
    {
      title: 'Find Orphan Translation Keys',
      description:
        'Find translation keys that exist in locale JSON files but are not referenced in any Vue/TS source code. '
        + 'Scans a specific layer or all layers. Reports keys that can potentially be removed. '
        + 'Also detects dynamic key patterns and uncertain matches. '
        + 'Scope-aware: each layer is checked only against code of the apps that consume it (summary.scanScope shows each layer\'s effective scope); '
        + 'keys referenced only from non-consuming apps are reported separately as misplacedUsages, not orphans.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to check for orphan keys (e.g., "root", "app-admin"). If omitted, checks all layers. Call discover to see available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale code to read translation keys from (e.g., "en", "en-US"). Defaults to the project default locale.'),
        scanDirs: z
          .array(z.string())
          .optional()
          .describe('Absolute paths to directories to scan for source code usage. Overrides scope-aware scanning: all layers are checked globally against these dirs. Example: ["/home/user/my-app/apps/admin"].'),
        excludeDirs: z
          .array(z.string())
          .optional()
          .describe('Directory names to skip when scanning source files. Example: ["storybook", "__tests__", "node_modules"].'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/orphan-keys.json"'),
      }),
    },
    async ({ layer, locale, scanDirs, excludeDirs, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await findOrphanKeys({ layer, locale, scanDirs, excludeDirs, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding orphan keys', error)
      }
    },
  )

  // ─── Tool: find_undefined_keys ────────────────────────────────

  server.registerTool(
    'find_undefined_keys',
    {
      title: 'Find Used-But-Undefined Translation Keys',
      description:
        'The inverse of find_orphan_keys: find keys referenced in source code but defined in NO locale file of the '
        + 'using app\'s consumed layers — the direction that ships raw keys to production. '
        + 'Scope-aware: each scan unit (app) is checked against the layers it consumes (summary.searchedLayersByApp); '
        + 'a key defined only in a layer the using app does not consume is still undefined for that app. '
        + 'Known limitation: extraction is line-based and static — dynamically built keys (template literals, '
        + 'concatenation) cannot be verified and are reported as uncertainKeys, never as hard findings.',
      inputSchema: z.object({
        locale: z
          .string()
          .optional()
          .describe('Reference locale to resolve key definitions in (e.g., "en", "en-US"). Defaults to the project default locale.'),
        scanDirs: z
          .array(z.string())
          .optional()
          .describe('Absolute paths to directories to scan for source code usage. Overrides scope-aware scanning: every layer counts as resolvable from these dirs. Example: ["/home/user/my-app/apps/admin"].'),
        excludeDirs: z
          .array(z.string())
          .optional()
          .describe('Directory names to skip when scanning source files. Example: ["storybook", "__tests__", "node_modules"].'),
        projectDir: projectDirInput(),
        outputFile: outputFileInput('/tmp/undefined-keys.json'),
      }),
    },
    async ({ locale, scanDirs, excludeDirs, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await checkUndefinedKeys({ locale, scanDirs, excludeDirs, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding undefined keys', error)
      }
    },
  )

  // ─── Tool: find_duplicate_keys ────────────────────────────────

  server.registerTool(
    'find_duplicate_keys',
    {
      title: 'Find Duplicate Translation Keys Across Layers',
      description:
        'Find translation keys defined in BOTH a shared layer and an app layer that consumes it '
        + '(e.g. the same key in a monorepo root layer and in app-shop). At runtime the app layer\'s '
        + 'value shadows the shared one — collisions with divergent values are the dangerous case, '
        + 'because the shared value silently never shows. Compares one reference locale and reports '
        + 'each collision with both values and a divergent flag. Fix by deleting one side, never by moving.',
      inputSchema: z.object({
        locale: z
          .string()
          .optional()
          .describe('Locale code to compare values in (e.g., "de", "en-US"). Defaults to the project default locale.'),
        projectDir: projectDirInput(),
        outputFile: outputFileInput('/tmp/duplicate-keys.json'),
      }),
    },
    async ({ locale, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await findDuplicateKeys({ locale, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding duplicate keys', error)
      }
    },
  )

  // ─── Tool: remove_orphan_keys ────────────────────────

  server.registerTool(
    'remove_orphan_keys',
    {
      title: 'Remove Orphan Keys',
      description:
        'Find orphan keys (not referenced in source code) and remove them from all locale files. Always does a dry run first. '
        + 'Scope-aware like find_orphan_keys: each layer is checked against its consuming apps (summary.scanScope), and keys referenced only from '
        + 'non-consuming apps are reported as misplacedUsages and never removed.',
      inputSchema: z.object({
        layer: z
          .string()
          .optional()
          .describe('Layer name to clean up (e.g., "root", "app-admin"). If omitted, cleans all layers. Call discover to discover available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale code to read translation keys from for orphan detection (e.g., "en", "en-US"). Defaults to the project default locale.'),
        scanDirs: z
          .array(z.string())
          .optional()
          .describe('Absolute paths to directories to scan for source code usage. Overrides scope-aware scanning: all layers are checked globally against these dirs. Example: ["/home/user/my-app/apps/admin"].'),
        excludeDirs: z
          .array(z.string())
          .optional()
          .describe('Directory names to skip when scanning source files. Example: ["storybook", "__tests__", "node_modules"].'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true (default), only reports what would be removed without deleting anything. Set to false to permanently delete orphan keys.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/cleanup-unused.json"'),
      }),
    },
    async ({ layer, locale, scanDirs, excludeDirs, dryRun, projectDir = DEFAULT_PROJECT_DIR, outputFile }) => {
      try {
        const result = await removeOrphanKeys({ layer, locale, scanDirs, excludeDirs, dryRun, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('cleaning up unused translations', error)
      }
    },
  )

  // ─── Tool: scaffold_locale ────────────────────────────────────

  server.registerTool(
    'scaffold_locale',
    {
      title: 'Scaffold Locale',
      description:
        'Create empty locale files for new languages. Copies the key structure from the default locale with all values set to empty strings. Supports both JSON (Nuxt) and PHP (Laravel) formats. Does NOT modify framework config — the agent must add the locale to the framework config before calling this tool.',
      inputSchema: z.object({
        locales: z
          .array(z.string())
          .optional()
          .describe('Locale codes to scaffold empty files for (e.g., ["sv", "ja", "pt-BR"]). If omitted, auto-detects locales defined in config that are missing locale files.'),
        layer: z
          .string()
          .optional()
          .describe('Scope scaffolding to a single layer (e.g., "root", "app-admin"). If omitted, scaffolds across all layers. Call discover to discover available layers.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns what files would be created without writing them. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Defaults to I18N_PROJECT_DIR, then server cwd. Example: "/home/user/my-app".'),
      }),
    },
    async ({ locales, layer, dryRun, projectDir = DEFAULT_PROJECT_DIR }) => {
      try {
        const result = await scaffoldLocaleFiles({ locales, layer, dryRun, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('scaffolding locale', error)
      }
    },
  )

  // ─── Resources ────────────────────────────────────────────────

  // Resources resolve their own config (cached after first detection) — no
  // prior discover call required. Cross-call ordering dependencies are
  // incompatible with the stateless request/response model of MCP 2026-07-28.
  server.registerResource(
    'locale-file',
    new ResourceTemplate('i18n:///{layer}/{locale}', {
      list: async () => {
        const config = getCachedConfig() ?? await detectI18nConfig(DEFAULT_PROJECT_DIR).catch(() => null)
        if (!config) {
          return { resources: [] }
        }
        const resources: Array<{
          uri: string
          name: string
          description?: string
          mimeType?: string
        }> = []

        for (const localeDir of config.localeDirs) {
          if (localeDir.aliasOf) continue
          for (const locale of config.locales) {
            resources.push({
              uri: `i18n:///${localeDir.layer}/${locale.code}`,
              name: `${localeDir.layer}/${locale.code}`,
              description: `${locale.name ?? locale.code} translations for ${localeDir.layer} layer`,
              mimeType: 'application/json',
            })
          }
        }

        return { resources }
      },
    }),
    {
      description: 'Locale translation file for a specific layer and locale',
      mimeType: 'application/json',
    },
    async (uri, { layer, locale }) => {
      const config = getCachedConfig() ?? await detectI18nConfig(DEFAULT_PROJECT_DIR)
      const localeDef = findLocaleImpl(config, locale as string)
      if (!localeDef) {
        throw new Error(`Locale not found: ${locale}`)
      }
      const data = await readLocaleData(config, layer as string, localeDef)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      }
    },
  )

  // ─── Prompts ──────────────────────────────────────────────────

  server.registerPrompt(
    'add-feature-translations',
    {
      title: 'Add Feature Translations',
      description: 'Guided workflow for adding i18n translations when building a new feature.',
      argsSchema: z.object({
        layer: z.string().optional().describe('Target layer (e.g., "root", "app-admin"). If omitted, uses layerRules from project config.'),
        namespace: z.string().optional().describe('Key namespace for the feature (e.g., "admin.users", "common.actions")'),
        projectDir: z.string().optional().describe('Absolute path to the Nuxt project root. Defaults to I18N_PROJECT_DIR, then server cwd.'),
      }),
    },
    async ({ layer, namespace, projectDir }) => {
      const dir = projectDir ?? DEFAULT_PROJECT_DIR
      let projectConfigSection = ''

      try {
        const config = await detectI18nConfig(dir)
        projectConfigSection = buildProjectConfigSection(config.projectConfig)
      } catch {
        // Config detection failed — still provide the prompt without project context
      }

      const layerHint = layer ? `Target layer: ${layer}` : 'Determine the target layer using the layer rules below, or ask the user.'
      const nsHint = namespace ? `Feature namespace: ${namespace}` : 'Determine the key namespace based on the feature.'

      const promptText = `You are adding i18n translations for a new feature.
${layerHint}
${nsHint}
${projectConfigSection}
Follow these steps:

1. Call \`discover\` to understand the project setup (locales, layers, default locale).
2. Call \`search_translations\` to check for existing similar keys — avoid duplicates.
3. Call \`write_translations\` with mode: 'add' to add keys for ALL locales in a single call.
   - Provide translations for every locale defined in the project.
   - Follow the glossary and style examples if provided above.
   - Preserve all {placeholders} and @:linked.references.
4. If you only provided translations for some locales, call \`translate_missing\` to fill in the rest.
   - Pass \`keys\` explicitly (the exact dot-path keys you just added) to skip the missing-key scan.
   - In provider mode (server env-configured with a provider), it translates and writes directly.
   - In agent mode, it returns fallbackContexts — translate them inline, then persist via \`write_translations\`.
5. Summarize what was added.`

      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: promptText },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'add-language',
    {
      title: 'Add Language',
      description: 'Add a new language to the project: update framework config, scaffold empty locale files, then translate all keys.',
      argsSchema: z.object({
        language: z.string().describe('Language to add (e.g., "Swedish", "sv", "sv-SE")'),
        projectDir: z.string().optional().describe('Absolute path to the project root. Defaults to I18N_PROJECT_DIR, then server cwd.'),
      }),
    },
    async ({ language, projectDir }) => {
      const dir = projectDir ?? DEFAULT_PROJECT_DIR
      let configSection = ''

      try {
        const config = await detectI18nConfig(dir)
        configSection += `\nDETECTED FRAMEWORK: ${config.framework ?? 'unknown'}`
        configSection += `\nDEFAULT LOCALE: ${config.defaultLocale}`
        configSection += `\nEXISTING LOCALES: ${config.locales.map(l => `${l.code} (${l.language})`).join(', ')}`
        configSection += `\nLAYERS: ${config.localeDirs.filter(d => !d.aliasOf).map(d => d.layer).join(', ')}`
        configSection += buildProjectConfigSection(config.projectConfig)
      } catch {
        configSection += '\nConfig detection failed — you will need to call discover manually.'
      }

      const promptText = `Add "${language}" as a new language to this project.
${configSection}

Follow these steps:

1. Add the new locale to the framework configuration:
   - **Nuxt**: Add the locale entry to \`i18n.locales\` in \`nuxt.config.ts\` (code, language, file).
   - **Laravel**: Add the locale code to the \`available_locales\` array in \`config/app.php\`.
2. Call \`scaffold_locale\` with the new locale code to create empty locale files in all layers.
3. Call \`translate_missing\` for each layer to translate all keys from the default locale. Concurrency is handled internally — each layer call is independent and can run in parallel.
   - In provider mode (server env-configured with a provider), it translates and writes directly.
   - In agent mode, it returns fallbackContexts — translate them inline, then call \`write_translations\` with mode: 'update'.
4. Call \`get_missing_translations\` to verify the new locale has zero missing keys in every layer.
5. Report a summary: locale code added, files created, keys translated per layer.`

      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: promptText },
          },
        ],
      }
    },
  )

  return server
}
