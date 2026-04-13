# the-i18n-mcp

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![CI][ci-src]][ci-href]

MCP server for managing i18n translations in **Nuxt** and **Laravel** projects. Provides 14 tools for the full translation lifecycle: read, write, search, rename, remove, find missing, auto-translate, and detect unused keys — all without loading entire locale files into context. Auto-detects your framework, supports monorepos and layers, and works with any MCP host (VS Code, Cursor, Zed, Claude Desktop).

> **Migrating from `nuxt-i18n-mcp`?** The old package name still works — both `npx the-i18n-mcp` and `npx nuxt-i18n-mcp` point to the same server. No breaking changes for existing Nuxt users.

## Supported Frameworks

| Framework | Locale Format | Auto-Detection | Config Source |
|-----------|--------------|----------------|---------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` | `@nuxt/kit` (optional peer dep) |
| **Laravel** (9+) | PHP arrays | `artisan`, `composer.json`, `lang/` directory | Built-in |

The server detects your framework automatically based on project structure. You can also force it via `"framework": "laravel"` or `"framework": "nuxt"` in `.i18n-mcp.json`.

## Quick Start

### 1. Configure your MCP host

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

### 2. Ask your agent

That's it — no configuration needed. The server auto-detects your project structure, locales, and layers. Just ask:

> *"Add a 'save changes' button translation in all locales"*
>
> *"Find and fix all missing translations in the admin layer"*
>
> *"Rename `common.actions.delete` to `common.actions.remove` across all locales"*

## Typical Workflow

```
1. detect_i18n_config        → understand project structure, locales, layers
2. list_locale_dirs           → see available layers with file counts and key namespaces
3. get_missing_translations   → find gaps between reference locale and targets
4. add_translations           → add new keys (requires layer param)
   translate_missing          → auto-translate missing keys via MCP sampling
5. find_orphan_keys           → find keys not referenced in source code
   cleanup_unused_translations → remove orphan keys in one step
```

Always call `detect_i18n_config` first — all other tools depend on the detected config.

## Tools

Every write tool requires a `layer` parameter (e.g., `"root"`, `"app-admin"`, `"lang"`). Use `list_locale_dirs` to discover available layers.

| Tool | Description |
|------|-------------|
| `detect_i18n_config` | Auto-detects framework (Nuxt or Laravel), returns locales, layers, directories, and project config. **Call first.** |
| `list_locale_dirs` | Lists locale directories grouped by layer, with file counts and top-level key namespaces |
| `get_translations` | Reads values for dot-path keys from a locale/layer. Use `"*"` as locale for all locales |
| `add_translations` | Adds new keys to a **layer** across locales. Fails if key already exists. Supports `dryRun` |
| `update_translations` | Updates existing keys in a **layer**. Fails if key doesn't exist. Supports `dryRun` |
| `remove_translations` | Removes keys from ALL locale files in a **layer**. Supports `dryRun` |
| `rename_translation_key` | Renames/moves a key across all locales in a **layer**. Conflict detection + `dryRun` |
| `get_missing_translations` | Finds keys present in reference locale but missing/empty in targets. `""` counts as missing |
| `find_empty_translations` | Finds keys with empty string values. Checks each locale independently |
| `search_translations` | Searches by key pattern or value substring across layers and locales |
| `translate_missing` | Auto-translates via MCP sampling, or returns context for inline translation when sampling unavailable |
| `find_orphan_keys` | Finds keys not referenced in source code. Scans Vue/TS for Nuxt, Blade/PHP for Laravel |
| `scan_code_usage` | Shows where keys are used — file paths, line numbers, call patterns |
| `cleanup_unused_translations` | Finds orphan keys + removes them in one step. Dry-run by default |

### Prompts

| Prompt | Description |
|--------|-------------|
| `add-feature-translations` | Guided workflow for adding translations when building a new feature. Accepts optional `layer` and `namespace` |
| `fix-missing-translations` | Find and fix all missing translations across the project. Accepts optional `layer` |

### Resources

| Resource | Description |
|----------|-------------|
| `i18n:///{layer}/{file}` | Browse locale files directly (e.g., `i18n:///root/en-US.json`) |

## Framework-Specific Details

### Nuxt

- Auto-detects `nuxt.config.ts` with `@nuxtjs/i18n` via `@nuxt/kit`
- Supports monorepos: discovers all Nuxt apps under the given `projectDir`
- Supports Nuxt layers: each layer's locale directory becomes a separate layer
- Requires `@nuxt/kit` as a peer dependency (already present in Nuxt projects)
- Scans `.vue`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts` for `$t()`, `t()`, `this.$t()`

### Laravel

- Auto-detects Laravel projects via `artisan`, `composer.json`, or `lang/` directory
- Supports both `lang/` (Laravel 9+) and `resources/lang/` (legacy) layouts
- Reads and writes PHP array locale files (`return ['key' => 'value'];`)
- No additional dependencies required — works out of the box
- Scans `.blade.php` and `.php` for `__()`, `trans()`, `trans_choice()`, `Lang::get()`, `@lang()`

## Monorepo Support (Nuxt)

The server discovers all Nuxt apps with i18n configuration under the given `projectDir`. Pass the monorepo root and it walks the directory tree, finds every `nuxt.config.ts` with i18n settings, loads each app via `@nuxt/kit`, and merges the results. Each app's locale directories become separate layers.

```
monorepo/
├── apps/
│   ├── shop/          ← discovered, becomes "shop" layer
│   │   └── nuxt.config.ts (has i18n)
│   └── admin/         ← discovered, becomes "admin" layer
│       └── nuxt.config.ts (has i18n)
├── packages/
│   └── shared/        ← skipped, no nuxt.config with i18n
└── package.json
```

Discovery stops descending into a directory once it finds a `nuxt.config` — nested Nuxt layers are loaded by `@nuxt/kit` automatically.

## Project Config

Optionally drop a `.i18n-mcp.json` at your project root to give the agent project-specific context. Everything is optional — the server passes them to the agent, which interprets the natural-language rules. The server walks up from `projectDir` to find the nearest config file (like ESLint or tsconfig resolution).

For IDE autocompletion, point to the schema:

```json
{
  "$schema": "node_modules/the-i18n-mcp/schema.json"
}
```

| Field | Purpose |
|-------|---------|
| `context` | Free-form project background (business domain, user base, brand voice) |
| `layerRules` | Rules for which layer a new key belongs to, with natural-language `when` conditions |
| `glossary` | Term dictionary for consistent translations |
| `translationPrompt` | System prompt prepended to all translation requests |
| `localeNotes` | Per-locale instructions (e.g., `"de-DE-formal": "Use 'Sie', not 'du'"`) |
| `examples` | Few-shot translation examples demonstrating project style |
| `orphanScan` | Per-layer config for orphan detection: `scanDirs` (overrides auto-discovered dirs) and `ignorePatterns` (glob) |
| `reportOutput` | `true` for default `.i18n-reports/` dir, or a string for a custom path. Diagnostic tools write full output to disk and return only a summary in the MCP response |

### Full example

```json
{
  "$schema": "node_modules/the-i18n-mcp/schema.json",
  "context": "B2B SaaS booking platform. Professional but approachable tone.",
  "layerRules": [
    {
      "layer": "shared",
      "description": "Shared translations: common.actions.*, common.messages.*",
      "when": "The key is generic enough to be used in multiple apps"
    },
    {
      "layer": "app-admin",
      "description": "Admin dashboard translations",
      "when": "The key is only relevant to admin functionality"
    }
  ],
  "glossary": {
    "Buchung": "Booking (never 'Reservation')",
    "Ressource": "Resource (a bookable entity like a room, desk, or person)",
    "Termin": "Appointment"
  },
  "translationPrompt": "Use professional but approachable tone. Preserve all {placeholders}. Keep translations concise.",
  "localeNotes": {
    "de-DE-formal": "Formal German using 'Sie'. Used by enterprise customers.",
    "en-US": "American English.",
    "en-GB": "British English. Use 'colour' not 'color'."
  },
  "examples": [
    {
      "key": "common.actions.save",
      "de-DE": "Speichern",
      "en-US": "Save",
      "note": "Concise, imperative"
    }
  ],
  "orphanScan": {
    "shared": {
      "scanDirs": ["apps/shop", "apps/admin", "packages/shared"],
      "ignorePatterns": ["common.datetime.**", "common.countries.*"]
    },
    "app-admin": {
      "scanDirs": ["apps/admin"]
    }
  },
  "reportOutput": true
}
```

See [`playground/.i18n-mcp.json`](playground/.i18n-mcp.json) for a working example.

## Features

- **Multi-framework** — auto-detects Nuxt and Laravel projects. `@nuxt/kit` is only needed for Nuxt.
- **Zero config** — reads `nuxt.config.ts` or Laravel `lang/` directory automatically. Works in monorepos.
- **Safe writes** — atomic file I/O (temp file + rename), indentation preservation, alphabetical key sorting, `{placeholder}` and `@:linked` ref validation.
- **Full lifecycle** — add, update, remove, rename, search, find missing, auto-translate, and clean up unused keys.
- **Code analysis** — find orphan keys not referenced in source (Vue/TS for Nuxt, Blade/PHP for Laravel), scan usage locations, bulk cleanup.
- **Project-aware** — optional `.i18n-mcp.json` for glossary, tone, layer rules, locale-specific instructions, and few-shot examples.
- **Caching** — config detection and file reads are cached (mtime-based). Writes invalidate automatically.
- **Sampling support** — `translate_missing` uses MCP sampling when available (VS Code). Falls back to returning context for inline translation (Zed, others).

## Roadmap

- [ ] `find_hardcoded_strings` — detect user-facing strings not wrapped in translation calls
- [ ] `move_translations` — move keys between layers (e.g., promote to shared)
- [ ] Glossary validation — check translations against glossary terms
- [ ] Flat JSON support — `flatJson: true` in vue-i18n config
- [ ] Pluralization support — vue-i18n plural forms and Laravel `trans_choice`
- [ ] Plain vue-i18n support (without Nuxt)

## Development

```bash
pnpm build          # Build via tsdown → dist/index.js
pnpm test           # Run all tests
pnpm test:perf      # Run performance benchmarks
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm start          # Start the server on stdio
pnpm inspect        # Open MCP Inspector for manual testing
```

## License

[MIT](./LICENSE)

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d
[npm-version-href]: https://npmjs.com/package/the-i18n-mcp

[npm-downloads-src]: https://img.shields.io/npm/dm/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d
[npm-downloads-href]: https://npmjs.com/package/the-i18n-mcp

[license-src]: https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d
[license-href]: https://github.com/fabkho/the-i18n-mcp/blob/main/LICENSE

[ci-src]: https://github.com/fabkho/the-i18n-mcp/actions/workflows/ci.yml/badge.svg
[ci-href]: https://github.com/fabkho/the-i18n-mcp/actions/workflows/ci.yml
