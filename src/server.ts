import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { detectI18nConfig, clearConfigCache } from './config/detector.js'
import type { I18nConfig } from './config/types.js'
import { readLocaleFile, readLocaleFileWithMeta } from './io/json-reader.js'
import { writeLocaleFile, mutateLocaleFile } from './io/json-writer.js'
import {
  getNestedValue,
  setNestedValue,
  hasNestedKey,
  getLeafKeys,
} from './io/key-operations.js'
import { log } from './utils/logger.js'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'

/**
 * Create and configure the MCP server with all tools.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'nuxt-i18n-mcp',
    version: '0.1.0',
  })

  // Helper: resolve locale file path for a layer + locale file name
  function resolveLocaleFilePath(config: I18nConfig, layer: string, localeFile: string): string | null {
    const dir = config.localeDirs.find(d => d.layer === layer)
    if (!dir) return null
    // If this is an alias, resolve to the aliased layer's dir
    if (dir.aliasOf) {
      const aliasDir = config.localeDirs.find(d => d.layer === dir.aliasOf)
      if (aliasDir) return join(aliasDir.path, localeFile)
    }
    return join(dir.path, localeFile)
  }

  // Helper: find locale definition by locale code or file name
  function findLocale(config: I18nConfig, localeRef: string) {
    return config.locales.find(
      l => l.code === localeRef || l.file === localeRef || l.language === localeRef,
    )
  }

  // ─── Tool: detect_i18n_config ──────────────────────────────────

  server.registerTool(
    'detect_i18n_config',
    {
      title: 'Detect i18n Config',
      description:
        'Detect the Nuxt i18n configuration from the project. Returns locales, locale directories, default locale, and fallback chain. Call this first before using other tools.',
      inputSchema: {
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ projectDir }) => {
      try {
        const dir = projectDir ?? process.cwd()
        const config = await detectI18nConfig(dir)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(config, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error detecting i18n config: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  // ─── Tool: list_locale_dirs ────────────────────────────────────

  server.registerTool(
    'list_locale_dirs',
    {
      title: 'List Locale Directories',
      description:
        'List all i18n locale directories in the project, grouped by layer. Shows file count and top-level key namespaces per layer.',
      inputSchema: {
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ projectDir }) => {
      try {
        const dir = projectDir ?? process.cwd()
        const config = await detectI18nConfig(dir)

        const results = []

        for (const localeDir of config.localeDirs) {
          if (localeDir.aliasOf) {
            results.push({
              layer: localeDir.layer,
              path: localeDir.path,
              aliasOf: localeDir.aliasOf,
              fileCount: 0,
              topLevelKeys: [],
            })
            continue
          }

          const files = await readdir(localeDir.path)
          const jsonFiles = files.filter(f => f.endsWith('.json'))

          // Read first JSON file to get top-level keys
          let topLevelKeys: string[] = []
          if (jsonFiles.length > 0) {
            try {
              const sampleFile = join(localeDir.path, jsonFiles[0])
              const data = await readLocaleFile(sampleFile)
              topLevelKeys = Object.keys(data)
            } catch {
              // Ignore errors reading sample file
            }
          }

          results.push({
            layer: localeDir.layer,
            path: localeDir.path,
            fileCount: jsonFiles.length,
            topLevelKeys,
          })
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing locale dirs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
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
        layer: z.string().describe('Layer name (e.g., "root", "app-admin")'),
        locale: z
          .string()
          .describe('Locale code, file name, or "*" for all locales (e.g., "en", "en-US.json", "*")'),
        keys: z
          .array(z.string())
          .describe('Dot-separated key paths (e.g., ["common.actions.save"])'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ layer, locale, keys, projectDir }) => {
      try {
        const dir = projectDir ?? process.cwd()
        const config = await detectI18nConfig(dir)

        const localesToRead = locale === '*'
          ? config.locales
          : (() => {
              const found = findLocale(config, locale)
              if (!found) {
                throw new Error(`Locale not found: ${locale}. Available: ${config.locales.map(l => l.code).join(', ')}`)
              }
              return [found]
            })()

        const results: Record<string, Record<string, unknown>> = {}

        for (const loc of localesToRead) {
          const filePath = resolveLocaleFilePath(config, layer, loc.file)
          if (!filePath) {
            results[loc.code] = Object.fromEntries(keys.map(k => [k, null]))
            continue
          }

          try {
            const data = await readLocaleFile(filePath)
            results[loc.code] = Object.fromEntries(
              keys.map(k => [k, getNestedValue(data, k) ?? null]),
            )
          } catch {
            results[loc.code] = Object.fromEntries(keys.map(k => [k, null]))
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting translations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  // ─── Tool: add_translations ────────────────────────────────────

  server.registerTool(
    'add_translations',
    {
      title: 'Add Translations',
      description:
        'Add new translation keys to the specified layer. Provide translations per locale file name. Keys are inserted in alphabetical order. Fails if a key already exists (use update_translations instead).',
      inputSchema: {
        layer: z.string().describe('Layer name (e.g., "root", "app-admin")'),
        translations: z
          .record(
            z.string().describe('Dot-separated key path'),
            z.record(
              z.string().describe('Locale file name (e.g., "en-US.json") or locale code'),
              z.string().describe('Translation value'),
            ),
          )
          .describe('Map of key paths to locale-value pairs'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ layer, translations, projectDir }) => {
      try {
        const dir = projectDir ?? process.cwd()
        const config = await detectI18nConfig(dir)

        const added: string[] = []
        const skipped: string[] = []
        const filesWritten = new Set<string>()

        // Group translations by locale file
        const byFile = new Map<string, Array<{ key: string; value: string }>>()

        for (const [key, localeValues] of Object.entries(translations)) {
          for (const [localeRef, value] of Object.entries(localeValues)) {
            const locale = findLocale(config, localeRef)
            if (!locale) {
              log.warn(`Locale not found: ${localeRef}, skipping`)
              continue
            }
            const filePath = resolveLocaleFilePath(config, layer, locale.file)
            if (!filePath) {
              log.warn(`No locale dir found for layer '${layer}', skipping`)
              continue
            }
            if (!byFile.has(filePath)) {
              byFile.set(filePath, [])
            }
            byFile.get(filePath)!.push({ key, value })
          }
        }

        // Apply changes per file
        for (const [filePath, entries] of byFile) {
          await mutateLocaleFile(filePath, (data) => {
            for (const { key, value } of entries) {
              if (hasNestedKey(data, key)) {
                skipped.push(key)
              } else {
                setNestedValue(data, key, value)
                added.push(key)
              }
            }
          })
          filesWritten.add(filePath)
        }

        const summary = {
          added: [...new Set(added)],
          skipped: [...new Set(skipped)],
          filesWritten: filesWritten.size,
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adding translations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  // ─── Tool: update_translations ─────────────────────────────────

  server.registerTool(
    'update_translations',
    {
      title: 'Update Translations',
      description:
        'Update existing translation keys in the specified layer. Provide new values per locale file name. Fails if a key does not exist (use add_translations instead).',
      inputSchema: {
        layer: z.string().describe('Layer name (e.g., "root", "app-admin")'),
        translations: z
          .record(
            z.string().describe('Dot-separated key path'),
            z.record(
              z.string().describe('Locale file name (e.g., "en-US.json") or locale code'),
              z.string().describe('New translation value'),
            ),
          )
          .describe('Map of key paths to locale-value pairs'),
        projectDir: z
          .string()
          .optional()
          .describe('Absolute path to the Nuxt project root. Defaults to server cwd.'),
      },
    },
    async ({ layer, translations, projectDir }) => {
      try {
        const dir = projectDir ?? process.cwd()
        const config = await detectI18nConfig(dir)

        const updated: string[] = []
        const skipped: string[] = []
        const filesWritten = new Set<string>()

        // Group translations by locale file
        const byFile = new Map<string, Array<{ key: string; value: string }>>()

        for (const [key, localeValues] of Object.entries(translations)) {
          for (const [localeRef, value] of Object.entries(localeValues)) {
            const locale = findLocale(config, localeRef)
            if (!locale) {
              log.warn(`Locale not found: ${localeRef}, skipping`)
              continue
            }
            const filePath = resolveLocaleFilePath(config, layer, locale.file)
            if (!filePath) {
              log.warn(`No locale dir found for layer '${layer}', skipping`)
              continue
            }
            if (!byFile.has(filePath)) {
              byFile.set(filePath, [])
            }
            byFile.get(filePath)!.push({ key, value })
          }
        }

        // Apply changes per file
        for (const [filePath, entries] of byFile) {
          await mutateLocaleFile(filePath, (data) => {
            for (const { key, value } of entries) {
              if (!hasNestedKey(data, key)) {
                skipped.push(key)
              } else {
                setNestedValue(data, key, value)
                updated.push(key)
              }
            }
          })
          filesWritten.add(filePath)
        }

        const summary = {
          updated: [...new Set(updated)],
          skipped: [...new Set(skipped)],
          filesWritten: filesWritten.size,
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error updating translations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  return server
}
