import { createRequire } from 'node:module'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

import {
  detectI18nConfig,
  getCachedConfig,
  readLocaleData,
  ToolError,
  detectConfig,
  listLocaleDirs,
  getTranslations,
  writeTranslations,
  getMissingTranslations,
  searchTranslations,
  removeTranslations,
  renameTranslationKey,
  translateMissing,
  translateKey,
  findOrphanKeys,
  removeOrphanKeys,
  scaffoldLocaleFiles,
  findLocaleImpl,
} from 'the-i18n-cli'

import type { SamplingFn, ProgressFn, ProjectConfig } from 'the-i18n-cli'

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
          : `Error ${context}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  }
}

/**
 * Wrap a plain result object as MCP text content.
 */
function jsonContent(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

/**
 * Create and configure the MCP server with all tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'the-i18n-mcp',
    version,
  })

  // ─── Tool: discover ────────────────────────────────────────────

  server.registerTool(
    'discover',
    {
      title: 'Discover i18n Setup',
      description:
        'Discover the complete i18n setup. Returns project config (locales, default locale, layers, '
        + 'fallback chain, glossary, translation style) plus per-layer directory listings with file '
        + 'counts and top-level key namespaces. Call this first — it warms the config cache that all '
        + 'other tools depend on.',
      inputSchema: {
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the project root. Defaults to server cwd.'),
      },
    },
    async ({ projectDir }) => {
      try {
        // Detect config first (warms cache)
        const config = await detectConfig(projectDir)
        // Then get layer directory info
        const dirs = await listLocaleDirs(projectDir)
        return jsonContent({
          ...config,
          layers: dirs,
        })
      } catch (error) {
        return toolErrorResponse('discovering i18n setup', error)
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
      inputSchema: {
        layer: z
          .string()
          .describe('Layer name from discover (e.g., "root", "app-admin"). Call discover to discover available layers.'),
        locale: z
          .string()
          .describe('Locale code, locale file name, or "*" to read all locales. Examples: "en", "en-US", "en-US.json", "*".'),
        keys: z
          .array(z.string())
          .describe('Dot-separated key paths to read. Example: ["common.actions.save", "auth.login.title"].'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ layer, locale, keys, projectDir }) => {
      try {
        const result = await getTranslations({ layer, locale, keys, projectDir })
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
      inputSchema: {
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
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ layer, translations, mode, dryRun, projectDir }) => {
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
      inputSchema: {
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
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/missing-translations.json"'),
      },
    },
    async ({ layer, referenceLocale, targetLocales, projectDir, outputFile }) => {
      try {
        const result = await getMissingTranslations({ layer, referenceLocale, targetLocales, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding missing translations', error)
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
      inputSchema: {
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
          .describe('Layer name to search in (e.g., "root", "app-admin"). If omitted, searches all layers. Call discover to discover available layers.'),
        locale: z
          .string()
          .optional()
          .describe('Locale code to search in (e.g., "en", "de"). If omitted, searches all locales.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/search-results.json"'),
      },
    },
    async ({ query, searchIn, layer, locale, projectDir, outputFile }) => {
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
      inputSchema: {
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
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ layer, keys, dryRun, projectDir }) => {
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
      inputSchema: {
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
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ layer, oldKey, newKey, dryRun, projectDir }) => {
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
        'Find keys missing in target locales and translate them. Uses the host LLM via MCP sampling if available, otherwise returns context for the agent to translate inline. Uses project config (glossary, translation prompt, locale notes, examples) if available. Translates all locales concurrently by default — pass all targetLocales at once.',
      annotations: {
        title: 'Translate Missing Translations',
        readOnlyHint: false,
      },
      inputSchema: {
        layer: z
          .string()
          .describe('Layer name from discover to translate (e.g., "root", "app-admin"). Call discover to discover available layers.'),
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
          .describe('Max keys per LLM sampling request. Default: 50. Lower values reduce per-batch risk but increase round trips.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, returns which keys would be translated without calling the LLM or writing files. Default: false.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ layer, referenceLocale, targetLocales, keys, batchSize, dryRun, projectDir }, extra) => {
      try {
        // Check sampling support from MCP client capabilities
        const clientCapabilities = server.server.getClientCapabilities()
        const samplingSupported = !!clientCapabilities?.sampling

        // Build progressFn from MCP progress notifications.
        // progressTotal is set by the onProgressTotal callback below, which runs
        // during the pre-scan phase of translateMissing — before any progress
        // notifications are sent. This temporal coupling is safe because the core
        // operation always pre-scans before emitting progress.
        const progressToken = extra._meta?.progressToken
        let progressCurrent = 0
        let progressTotal: number | undefined
        const progressFn: ProgressFn = async (message: string) => {
          if (progressToken === undefined) return
          progressCurrent++
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: progressCurrent,
              total: progressTotal,
              message,
            },
          })
        }

        // Build samplingFn from MCP server sampling
        const samplingFn: SamplingFn | undefined = samplingSupported
          ? async (opts) => {
              const SAMPLING_TIMEOUT_MS = 120_000 // 2 minutes per batch
              const samplingResult = await server.server.createMessage({
                messages: [
                  {
                    role: 'user',
                    content: { type: 'text', text: opts.userMessage },
                  },
                ],
                systemPrompt: opts.systemPrompt,
                maxTokens: opts.maxTokens,
                temperature: 0,
                includeContext: 'none',
                modelPreferences: {
                  hints: opts.preferences.hints,
                  costPriority: opts.preferences.costPriority,
                  speedPriority: opts.preferences.speedPriority,
                  intelligencePriority: opts.preferences.intelligencePriority,
                },
              }, {
                timeout: SAMPLING_TIMEOUT_MS,
              })

              const responseText = samplingResult.content.type === 'text'
                ? samplingResult.content.text
                : ''

              return {
                text: responseText,
                model: samplingResult.model,
              }
            }
          : undefined

        const result = await translateMissing({
          layer,
          referenceLocale,
          targetLocales,
          keys,
          batchSize,
          dryRun,
          projectDir,
          samplingFn,
          progressFn,
          onProgressTotal: (total) => { progressTotal = total },
        })

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
        'Add/update one source translation key and translate it into target locales. Unlike translate_missing, this can overwrite existing stale target translations.',
      annotations: {
        title: 'Translate Single Key',
        readOnlyHint: false,
      },
      inputSchema: {
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
          .describe('When true, previews source/target locales without writing files or calling sampling.'),
        includePreview: z
          .boolean()
          .optional()
          .describe('When true, include translated values in output. Default false to keep responses compact.'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ layer, key, sourceLocale, sourceValue, targetLocales, overwrite, dryRun, includePreview, projectDir }) => {
      try {
        const clientCapabilities = server.server.getClientCapabilities()
        const samplingSupported = !!clientCapabilities?.sampling
        const samplingFn: SamplingFn | undefined = samplingSupported
          ? async (opts) => {
              const SAMPLING_TIMEOUT_MS = 120_000
              const samplingResult = await server.server.createMessage({
                messages: [
                  {
                    role: 'user',
                    content: { type: 'text', text: opts.userMessage },
                  },
                ],
                systemPrompt: opts.systemPrompt,
                maxTokens: opts.maxTokens,
                temperature: 0,
                includeContext: 'none',
                modelPreferences: {
                  hints: opts.preferences.hints,
                  costPriority: opts.preferences.costPriority,
                  speedPriority: opts.preferences.speedPriority,
                  intelligencePriority: opts.preferences.intelligencePriority,
                },
              }, {
                timeout: SAMPLING_TIMEOUT_MS,
              })

              const responseText = samplingResult.content.type === 'text'
                ? samplingResult.content.text
                : ''

              return {
                text: responseText,
                model: samplingResult.model,
              }
            }
          : undefined

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
          samplingFn,
        })

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
        + 'Also detects dynamic key patterns and uncertain matches.',
      inputSchema: {
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
          .describe('Absolute paths to directories to scan for source code usage. Defaults to all layer root directories. Example: ["/home/user/my-app/apps/admin"].'),
        excludeDirs: z
          .array(z.string())
          .optional()
          .describe('Directory names to skip when scanning source files. Example: ["storybook", "__tests__", "node_modules"].'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/orphan-keys.json"'),
      },
    },
    async ({ layer, locale, scanDirs, excludeDirs, projectDir, outputFile }) => {
      try {
        const result = await findOrphanKeys({ layer, locale, scanDirs, excludeDirs, projectDir, outputFile })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('finding orphan keys', error)
      }
    },
  )

  // ─── Tool: remove_orphan_keys ────────────────────────

  server.registerTool(
    'remove_orphan_keys',
    {
      title: 'Remove Orphan Keys',
      description:
        'Find orphan keys (not referenced in source code) and remove them from all locale files. Always does a dry run first.',
      inputSchema: {
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
          .describe('Absolute paths to directories to scan for source code usage. Defaults to all layer root directories. Example: ["/home/user/my-app/apps/admin"].'),
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
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd. Example: "/home/user/my-app".'),
        outputFile: z
          .string()
          .optional()
          .describe('Absolute path to write full JSON output. Returns only a compact summary to the caller — use this for large outputs to avoid flooding the conversation context. Example: "/tmp/cleanup-unused.json"'),
      },
    },
    async ({ layer, locale, scanDirs, excludeDirs, dryRun, projectDir, outputFile }) => {
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
      inputSchema: {
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
          .describe('Absolute path to the project root. Defaults to server cwd. Example: "/home/user/my-app".'),
      },
    },
    async ({ locales, layer, dryRun, projectDir }) => {
      try {
        const result = await scaffoldLocaleFiles({ locales, layer, dryRun, projectDir })
        return jsonContent(result)
      } catch (error) {
        return toolErrorResponse('scaffolding locale', error)
      }
    },
  )

  // ─── Resources ────────────────────────────────────────────────

  server.registerResource(
    'locale-file',
    new ResourceTemplate('i18n:///{layer}/{locale}', {
      list: async () => {
        const config = getCachedConfig()
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
      const config = getCachedConfig()
      if (!config) {
        throw new Error('No i18n config detected yet. Call discover first.')
      }
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
      argsSchema: {
        layer: z.string().optional().describe('Target layer (e.g., "root", "app-admin"). If omitted, uses layerRules from project config.'),
        namespace: z.string().optional().describe('Key namespace for the feature (e.g., "admin.users", "common.actions")'),
        projectDir: z.string().optional().describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ layer, namespace, projectDir }) => {
      const dir = projectDir ?? process.cwd()
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
   - Pass \`keys\` explicitly (the exact dot-path keys you just added) to skip the missing-key scan and go straight to sampling.
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
      argsSchema: {
        language: z.string().describe('Language to add (e.g., "Swedish", "sv", "sv-SE")'),
        projectDir: z.string().optional().describe('Absolute path to the project root. Defaults to server cwd.'),
      },
    },
    async ({ language, projectDir }) => {
      const dir = projectDir ?? process.cwd()
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
3. Call \`translate_missing\` for each layer to auto-translate all keys from the default locale. Concurrency is handled internally — each layer call is independent and can run in parallel.
   - If auto-translation is unavailable, use \`get_translations\` to read the default locale, translate the keys yourself, then call \`write_translations\` with mode: 'update'.
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
