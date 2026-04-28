# the-i18n-mcp

[![npm version](https://img.shields.io/npm/v/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp)
[![npm downloads](https://img.shields.io/npm/dm/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

MCP server for managing i18n translation files — gives your AI agent full control over your app's translations without dumping entire locale files into context.

15 purpose-built tools that let the agent work surgically — touching only the keys it needs. Auto-detects Nuxt, Laravel, or any project with JSON/PHP locale files.

Part of [the-i18n-kit](https://github.com/fabkho/the-i18n-kit) monorepo. For CLI usage, see [the-i18n-cli](https://www.npmjs.com/package/the-i18n-cli).

## Quick Start

No install needed — your MCP host runs the server via `npx`.

<details>
<summary><strong>VS Code / Cursor</strong></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "the-i18n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["the-i18n-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Zed</strong></summary>

Add to `.zed/settings.json`:

```json
{
  "context_servers": {
    "the-i18n-mcp": {
      "command": "npx",
      "args": ["the-i18n-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "the-i18n-mcp": {
      "command": "npx",
      "args": ["the-i18n-mcp@latest"]
    }
  }
}
```

</details>

Then just ask your agent:

> *"Add a 'save changes' button translation in all locales"*
>
> *"Find and fix all missing translations in the admin layer"*
>
> *"Add Swedish as a new language and translate everything"*

## What You Get

- **Auto-translate entire locales** — `translate_missing` batches keys to an LLM via MCP sampling, writes results back, and shows a progress bar
- **Add a new language in one shot** — the `add-language` prompt walks your agent through config updates, file scaffolding, and bulk translation
- **Safe, atomic writes** — temp file + rename cycle, indentation preserved, keys sorted alphabetically, `{placeholders}` validated
- **Smart caching** — config detection and file reads are mtime-cached, writes invalidate automatically
- **Monorepo & layer-aware** — discovers all Nuxt apps and layers under a project root
- **Dead key cleanup** — find orphan keys not referenced in source code and bulk-remove them

## Supported Frameworks

| Framework | Locale Format | Auto-Detection |
|-----------|--------------|----------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` |
| **Laravel** (9+) | PHP arrays | `artisan`, `composer.json`, `lang/` |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` |

## Tools

| Tool | Description |
|------|-------------|
| `detect_i18n_config` | Auto-detect framework, locales, layers. **Call first.** |
| `list_locale_dirs` | List locale directories by layer with file counts |
| `get_translations` | Read values for dot-path keys. `"*"` for all locales |
| `add_translations` | Add new keys across locales. Supports `dryRun` |
| `update_translations` | Update existing keys. Supports `dryRun` |
| `remove_translations` | Remove keys from all locale files in a layer |
| `rename_translation_key` | Rename/move a key across all locales |
| `get_missing_translations` | Find keys missing in target locales |
| `find_empty_translations` | Find keys with empty string values |
| `search_translations` | Search by key or value substring |
| `translate_missing` | Auto-translate via MCP sampling or return fallback context |
| `find_orphan_keys` | Find keys not referenced in source code |
| `scan_code_usage` | Find where keys are used (file paths + line numbers) |
| `cleanup_unused_translations` | Find + remove orphan keys. **Dry-run by default** |
| `scaffold_locale` | Create empty locale files for new languages |

### Prompts

| Prompt | Description |
|--------|-------------|
| `add-feature-translations` | Guided workflow for adding translations for a new feature |
| `fix-missing-translations` | Find and fix all missing translations across the project |
| `add-language` | Add a new language end-to-end: config, scaffold, translate, verify |

## Project Config

Drop a `.i18n-mcp.json` at your project root:

```json
{
  "$schema": "node_modules/the-i18n-mcp/schema.json",
  "context": "B2B SaaS booking platform",
  "glossary": {
    "Booking": "Core concept. Dutch: 'Boeking'.",
    "Resource": "A bookable entity (room, desk, person)"
  },
  "translationPrompt": "Professional but approachable tone. Keep translations concise.",
  "localeNotes": {
    "de": "Informal German (du)",
    "de-formal": "Formal German (Sie)"
  }
}
```

See the [full config reference](https://github.com/fabkho/the-i18n-kit#project-config) for all options including `layerRules`, `examples`, `orphanScan`, `samplingPreferences`.

## Model Selection for Translations

`translate_missing` uses [MCP sampling](https://modelcontextprotocol.io/docs/concepts/sampling) — the host picks which LLM fulfills the request. The server hints toward fast, cheap models since translation is high-volume.

**Default preferences:**

| Priority | Value |
|----------|-------|
| `hints` | `["flash", "haiku", "gpt-4o-mini"]` |
| `speedPriority` | `0.9` |
| `costPriority` | `0.8` |
| `intelligencePriority` | `0.3` |

Override via `samplingPreferences` in `.i18n-mcp.json`.

> **Tip:** In VS Code, restrict model access per-server via **MCP: List Servers** → **Configure Model Access** to force a specific fast model for translation batches.

## Migrating from v2

> `npx the-i18n-mcp` and `npx nuxt-i18n-mcp` still work — both bin names point to the same server. No configuration changes needed.

The MCP server API (tools, prompts, resources) is unchanged. The main difference is the internal restructure into a monorepo with the core logic in [the-i18n-cli](https://www.npmjs.com/package/the-i18n-cli).

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
