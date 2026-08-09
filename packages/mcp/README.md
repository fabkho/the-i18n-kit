# the-i18n-mcp

[![npm version](https://img.shields.io/npm/v/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp)
[![npm downloads](https://img.shields.io/npm/dm/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

MCP server for managing i18n translation files — gives your AI agent full control over your app's translations without dumping entire locale files into context.

13 purpose-built tools that let the agent work surgically — touching only the keys it needs. Auto-detects Nuxt, Laravel, or any project with JSON/PHP locale files.

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

- **Auto-translate entire locales** — `translate_missing` fills every missing key: with an env-configured provider the server batches keys to the LLM and writes validated results back (with progress notifications); without one it returns fallback contexts your agent translates inline (see [Translation Modes](#translation-modes))
- **Refresh one existing key** — `translate_key` updates a source locale and translates target locales, optionally overwriting stale existing values
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
| `discover` | Auto-detect framework, locales, layers, protected locales, and the active translation mode + list locale dirs by layer with file counts and namespaces. **Call first.** |
| `list_namespaces` | List the translation key tree grouped by namespace prefix, with counts per node |
| `get_translations` | Cross-locale view of keys with `locale: "*"` (add `compact: true` for a per-key summary) — or read a single locale |
| `write_translations` | Write key-value pairs. Mode: `upsert` (default), `add`, or `update`. Supports `dryRun` |
| `remove_translations` | Remove keys from all locale files in a layer |
| `rename_translation_key` | Rename/move a key across all locales |
| `get_missing_translations` | Find keys missing in target locales |
| `search_translations` | Search by key or value (case-insensitive substring, not fuzzy) |
| `translate_missing` | Find and translate missing keys — provider mode translates directly, agent mode returns fallback contexts |
| `translate_key` | Translate one source key into target locales; can overwrite stale values |
| `find_orphan_keys` | Find keys not referenced in source code |
| `remove_orphan_keys` | Find + remove orphan keys. **Dry-run by default** |
| `scaffold_locale` | Create empty locale files for new languages |

### Prompts

| Prompt | Description |
|--------|-------------|
| `add-feature-translations` | Guided workflow for adding translations for a new feature |
| `add-language` | Add a new language end-to-end: config, scaffold, translate, verify |

## Examples

### `write_translations` — Hand-crafted translations

Add a key to two locales (upsert mode never fails if key exists):
```json
{
  "layer": "root",
  "mode": "upsert",
  "translations": {
    "auth.login.title": {
      "en-US": "Welcome back",
      "de-DE": "Willkommen zurück"
    }
  }
}
```

Strict add (fails if key already exists):
```json
{
  "layer": "root",
  "mode": "add",
  "translations": {
    "common.actions.save": {
      "en-US": "Save",
      "de-DE": "Speichern",
      "fr-FR": "Enregistrer"
    }
  }
}
```

### `translate_key` — Single-key LLM translation

Source value provided inline, writes to source locale + translates to others:
```json
{
  "layer": "root",
  "key": "bookingCreator.options.removeSubResource",
  "sourceLocale": "en-US",
  "sourceValue": "Remove sub-resource",
  "targetLocales": ["de-DE", "fr-FR", "es-ES"],
  "overwrite": true
}
```

Source value read from existing locale file, only fill missing targets:
```json
{
  "layer": "root",
  "key": "auth.errors.sessionExpired",
  "sourceLocale": "en-US",
  "targetLocales": "all",
  "overwrite": false
}
```

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
  },
  "protectedLocales": ["en-US", "de-DE-formal"]
}
```

See the [full config reference](https://github.com/fabkho/the-i18n-kit#project-config) for all options including `layerRules`, `examples`, `orphanScan`, `protectedLocales`. `samplingPreferences` is deprecated and ignored (accepted for backward compatibility) — configure a provider via env instead (see below).

## Translation Modes

`translate_missing` and `translate_key` run in one of two modes, resolved once at server startup. Every result reports which mode ran (`mode: "provider" | "agent" | "dry-run"`), and `discover` reports the active mode as `translationMode` (plus `translationProvider` / `translationModel` in provider mode) so you can verify the configuration without triggering a translation.

### Provider mode

Set environment variables on the server process and the server calls the LLM provider directly, writes validated results, and streams progress notifications:

```json
{
  "servers": {
    "the-i18n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["the-i18n-mcp@latest"],
      "env": {
        "I18N_PROVIDER": "google",
        "I18N_MODEL": "gemini-2.5-flash",
        "GEMINI_API_KEY": "..."
      }
    }
  }
}
```

| Variable | Value |
|----------|-------|
| `I18N_PROVIDER` | `openai`, `anthropic`, or `google` |
| `I18N_MODEL` | Model name (e.g. `gemini-2.5-flash`, `gpt-4o-mini`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | API key matching the provider |

Partial configuration logs a warning to stderr and falls back to agent mode — a misconfigured server never surprises callers per-request.

### Agent mode (default)

With no provider configured, the translate tools return per-locale `fallbackContexts` — the source values plus glossary, translation prompt, locale notes, and examples from `.i18n-mcp.json`. The host agent translates them inline (using its own model) and persists the results via `write_translations` (mode `upsert`). This is the default in MCP hosts and needs zero configuration.

### Result contract

Translate results account for every key:

- `translated` — keys written
- `wouldTranslate` — dry runs only: keys that would be translated
- `failed` — with a reason: `provider-error`, `omitted-by-model`, `truncated`, `placeholder-mismatch`, `plural-mismatch`, `write-error`
- `skipped` — with a reason: `no-provider`, `already-translated`, `protected-locale`
- Invariant: `missing = translated + wouldTranslate + failed + skipped`

Provider translations are validated before writing: placeholder parity per vue-i18n plural variant (`{placeholders}`, `@:linked.refs`; `:params` for PHP) and plural variant-count parity with the source. Failing values are rejected into `failed` instead of written.

Locales listed in `protectedLocales` are excluded from default translate targets and reported as `skipped` with reason `protected-locale`; explicitly naming one in `targetLocales` overrides the protection with a warning.

## Migrating from older versions

> `npx the-i18n-mcp` and `npx nuxt-i18n-mcp` still work — both bin names point to the same server.

MCP sampling was removed: `translate_missing` no longer asks the host to pick a model, and `samplingPreferences` in `.i18n-mcp.json` is ignored (still accepted for backward compatibility). To keep server-side translation, configure provider mode via the env variables above; otherwise the tools run in agent mode and your agent translates the returned fallback contexts itself. The core logic lives in [the-i18n-cli](https://www.npmjs.com/package/the-i18n-cli).

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
