# the-i18n-mcp

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![CI][ci-src]][ci-href]

An MCP server that gives your AI agent full control over your app's translations — without dumping entire locale files into context.

Point it at a Nuxt or Laravel project and your agent can read, write, search, rename, and remove translation keys across all locales and layers. It auto-detects your framework, discovers monorepo structures, and handles the file I/O so the agent never has to parse JSON or PHP arrays manually.

### Why this exists

Managing translations with an AI agent sounds simple until you have 30 locales, 6 layers, and 4,000 keys. Pasting locale files into chat doesn't scale. This server exposes 15 purpose-built tools that let the agent work surgically — touching only the keys it needs.

### What you get out of the box

- **Auto-translate entire locales** — `translate_missing` batches keys to an LLM via MCP sampling, writes results back, and shows a progress bar. 1,000+ keys across 13 locales in minutes, not hours.
- **Add a new language in one shot** — the `add-language` prompt walks your agent through config updates, file scaffolding, and bulk translation end-to-end.
- **Safe, atomic writes** — every file write goes through a temp file + rename cycle. Indentation is preserved, keys are kept alphabetically sorted, and `{placeholders}` / `@:linked` refs are validated before writing.
- **Smart caching** — config detection and file reads are mtime-cached. Writes invalidate automatically. Repeated tool calls are fast.
- **Monorepo & layer-aware** — discovers all Nuxt apps and layers under a project root. Each layer's locale directory is a first-class citizen with its own tools scope.
- **Framework-agnostic tooling** — same 15 tools work for both Nuxt (JSON) and Laravel (PHP arrays). Auto-detection means zero config for most projects.
- **Project-aware translations** — drop a `.i18n-mcp.json` with your glossary, tone rules, and per-locale notes. The agent uses them in every translation request.
- **Dead key cleanup** — find orphan keys not referenced in source code, see exactly where keys are used, and bulk-remove unused translations in one step.

> **Migrating from `nuxt-i18n-mcp`?** The old package name still works — both `npx the-i18n-mcp` and `npx nuxt-i18n-mcp` point to the same server. No breaking changes.

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
>
> *"Add Swedish as a new language and translate everything"*

## Typical Workflows

### Day-to-day translation maintenance

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

### Adding a new language

Use the `add-language` prompt for a guided workflow, or do it manually:

```
1. Add the locale to your framework config (nuxt.config.ts or config/app.php)
2. scaffold_locale            → create empty locale files with key structure from default locale
3. translate_missing          → auto-translate all keys from the reference locale
4. get_missing_translations   → verify zero gaps remain
```

`scaffold_locale` copies every key from your default locale and sets all values to `""`. This gives `translate_missing` the complete key set to work with.

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
| `translate_missing` | Auto-translates via MCP sampling (batches of 50 keys by default), or returns context for inline translation when sampling is unavailable. Supports `batchSize` override. Each locale writes to its own file — parallel calls targeting different locales are safe |
| `find_orphan_keys` | Finds keys not referenced in source code. Scans Vue/TS for Nuxt, Blade/PHP for Laravel |
| `scan_code_usage` | Shows where keys are used — file paths, line numbers, call patterns |
| `cleanup_unused_translations` | Finds orphan keys + removes them in one step. **Dry-run by default** (`dryRun: true`) — pass `dryRun: false` to actually delete |
| `scaffold_locale` | Creates empty locale files for new languages. Copies key structure from default locale with all values set to `""`. Supports JSON (Nuxt) and PHP (Laravel) |

### Prompts

| Prompt | Description |
|--------|-------------|
| `add-feature-translations` | Guided workflow for adding translations when building a new feature. Accepts optional `layer` and `namespace` |
| `fix-missing-translations` | Find and fix all missing translations across the project. Accepts optional `layer` |
| `add-language` | Add a new language end-to-end: update framework config, scaffold locale files, translate all keys, and verify. Requires `language` (e.g., `"Swedish"`, `"sv"`) |

### Resources

| Resource | Description |
|----------|-------------|
| `i18n:///{layer}/{locale}` | Read a locale's translations for a specific layer (e.g., `i18n:///root/en-US`) |

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
- Uses `:placeholder` syntax (not `{placeholder}`) — reflect this in your `translationPrompt` and `examples`

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

Flat layouts work too — `app-shop/` and `app-admin/` at the project root are discovered the same way. Discovery stops descending into a directory once it finds a `nuxt.config` — nested Nuxt layers are loaded by `@nuxt/kit` automatically.

## How Orphan Detection Works

`find_orphan_keys` and `cleanup_unused_translations` use a multi-strategy approach to determine whether a translation key is referenced in source code. A key is only reported as an orphan if **none** of the strategies find a match.

### Strategy 1: Direct call detection

Scans for explicit i18n function calls on a single line:

| Framework | Patterns |
|-----------|----------|
| **Nuxt/Vue** | `$t('key')`, `t('key')`, `this.$t('key')`, `$te('key')`, `this.$te('key')` |
| **Laravel** | `__('key')`, `trans('key')`, `trans_choice('key', n)`, `Lang::get('key')`, `@lang('key')` |

Backtick literals without interpolation are promoted to static matches: `` t(`common.actions.save`) `` is treated the same as `t('common.actions.save')`.

### Strategy 2: Bare string matching

Extracts **all** quoted strings containing at least one dot from source files (e.g., `'common.actions.save'`), regardless of whether they appear inside a `t()` call. These are intersected with known translation keys — if a key appears as a dotted string anywhere in the codebase, it's considered used.

This catches keys referenced in data structures, config objects, or passed as variables:

```ts
// All detected via bare string matching — no t() call needed
const columns = [{ label: 'common.actions.save', i18n: true }]
const key = 'pages.dashboard.title'
```

### Strategy 3: Dynamic key detection (template literals)

Scans for template literals with `${...}` interpolation inside `t()` / `$t()` calls. Converts them to regex patterns and matches against all known keys:

```ts
t(`common.metrics.${metric}`)  // → matches common.metrics.revenue, common.metrics.bookings, etc.
t(`${prefix}.items.${id}.label`)  // → matches shop.items.42.label, admin.items.abc.label, etc.
```

### Strategy 4: Bare dynamic candidate matching

Extracts **all** template literals containing at least one dot and `${...}` interpolation from source files, regardless of `t()` context. Like bare string matching, these are optimistically treated as potential i18n patterns and matched against known keys.

This catches dynamic keys that are split across lines by formatters like Prettier, or used outside direct `t()` calls:

```vue
<!-- Prettier wraps long $t() calls — template literal is on a separate line -->
this.$t(
  `common.components.plans.trialPeriod.${interval}`
)

<!-- Dynamic keys in data structures -->
const keyPattern = `pages.${section}.title`
```

### Strategy 5: Ignore patterns

Keys matching glob patterns in `orphanScan.ignorePatterns` (from `.i18n-mcp.json`) are excluded:

```json
{
  "orphanScan": {
    "root": {
      "ignorePatterns": ["common.datetime.**", "common.countries.*"]
    }
  }
}
```

- `**` matches any number of dot-separated segments
- `*` matches exactly one segment

### Monorepo layer scoping

Each layer scans only its own source directory by default. With `includeParentLayer: true`, child apps (e.g., `app-admin`) also scan the shared root directory, excluding sibling apps.

## Orphan Detection Limitations

**String concatenation is not detected.** Keys constructed via `t('prefix.' + var + '.suffix')` will be incorrectly reported as orphans. Only template literals are supported.

**Mitigation:** Enable ESLint's built-in [`prefer-template`](https://eslint.org/docs/latest/rules/prefer-template) rule to auto-fix concatenation to template literals across your codebase:

```json
{ "prefer-template": "error" }
```

If you need a rule scoped specifically to i18n calls (`t()`, `$t()`, `$te()`), no existing plugin covers this — you'll need a custom ESLint rule:

<details>
<summary><strong>Custom ESLint rule: <code>no-i18n-concat</code></strong></summary>

```js
// eslint-rules/no-i18n-concat.js
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow string concatenation in i18n calls; use template literals.' },
    messages: { noConcat: 'Use a template literal instead of string concatenation in i18n calls.' },
  },
  create(context) {
    const fns = new Set(['t', '$t', '$te', '$tc', 'tc']);
    return {
      CallExpression(node) {
        const c = node.callee;
        const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? c.property.name : null;
        if (!name || !fns.has(name)) return;
        const arg = node.arguments[0];
        if (arg?.type === 'BinaryExpression' && arg.operator === '+') {
          context.report({ node: arg, messageId: 'noConcat' });
        }
      },
    };
  },
};
```

</details>

## Model Selection for Translations

`translate_missing` uses [MCP sampling](https://modelcontextprotocol.io/docs/concepts/sampling) — the host picks which LLM fulfills the request. The server sends `modelPreferences` hinting toward fast, cheap models since translation is high-volume and doesn't require frontier reasoning.

> **Recommended host: VS Code.** VS Code has the most complete MCP sampling implementation — it supports `temperature`, `modelPreferences`, `systemPrompt` hoisting, and lets you restrict which models the server can use per-server via the UI. Other hosts vary in their sampling support: some ignore `modelPreferences` or don't expose model selection. If `translate_missing` behaves unexpectedly (wrong model, no temperature control), your host's sampling implementation is likely the bottleneck.

**How batching works:** each batch sends up to 50 keys (configurable via `batchSize`) to the host LLM. Locales are processed sequentially within a single call — but since each locale writes to its own file, you can call `translate_missing` once per locale in parallel for faster throughput. A progress bar tracks completion across all locales and batches.

**Built-in defaults** (used when no `samplingPreferences` in `.i18n-mcp.json`):

| Priority | Value | Rationale |
|----------|-------|-----------|
| `hints` | `["flash", "haiku", "gpt-4o-mini"]` | Fastest models across providers (substring match) |
| `speedPriority` | `0.9` | Users watch a progress bar — latency matters |
| `costPriority` | `0.8` | Hundreds of batches add up |
| `intelligencePriority` | `0.3` | Translation needs quality, not reasoning |

Override via `samplingPreferences` in [`.i18n-mcp.json`](#project-config) if needed (e.g., to prefer a stronger model for nuanced locales).

**Controlling the model in VS Code:**

1. Command Palette → **MCP: List Servers** → select `the-i18n-mcp` → **Configure Model Access**
2. Restrict to your preferred model (e.g., only Gemini 2.5 Flash)
3. Your main chat/agent session continues using whatever model you chose — the restriction only applies to sampling requests from this MCP server

> **Tip:** For large translation runs (1,000+ keys), restricting to a fast model like Gemini 2.5 Flash significantly reduces wall-clock time. A batch of 50 keys typically completes in 10–20s with Flash. You can increase `batchSize` up to 200 for fewer round trips, but larger batches risk hitting the host's request timeout. For maximum throughput, call `translate_missing` once per locale in parallel — each locale writes to its own file, so concurrent calls are safe.

### Recommended workflow for large projects

A single `translate_missing` call processes locales sequentially. On a project with many locales and layers, this adds up. The fastest approach is to split locales across parallel calls and tackle layers in order of size.

**Step 1 — Start with your largest layer.** Split the target locales across 3–4 parallel `translate_missing` calls:

```
Call 1: layer "app-admin", targetLocales ["bg-BG", "da-DK", "el-GR"]
Call 2: layer "app-admin", targetLocales ["et-EE", "fi-FI", "ga-IE"]
Call 3: layer "app-admin", targetLocales ["hr-HR", "lt-LT", "lv-LV"]
Call 4: layer "app-admin", targetLocales ["mt-MT", "sk-SK", "sl-SI", "sv-SE"]
```

Each call runs independently — different locales, different files, no conflicts.

**Step 2 — Move to smaller layers.** Once the large layer finishes, translate the remaining layers. Small layers can run concurrently since each layer writes to its own directory:

```
Call 1: layer "app-shop",   targetLocales [all 13 locales]
Call 2: layer "app-panels", targetLocales [all 13 locales]
```

**Step 3 — Verify.** Run `get_missing_translations` across all layers to confirm zero gaps.

This pattern lets you translate thousands of keys across dozens of locales in minutes instead of waiting for one sequential run.

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
| `framework` | Force framework detection: `"nuxt"` or `"laravel"`. Normally auto-detected from project structure |
| `context` | Free-form project background (business domain, user base, brand voice) |
| `layerRules` | Rules for which layer a new key belongs to, with natural-language `when` conditions |
| `glossary` | Term dictionary for consistent translations |
| `translationPrompt` | System prompt prepended to all translation requests |
| `localeNotes` | Per-locale instructions — terminology constraints, formality, regional conventions. **Keys must match your locale codes exactly** (case-sensitive) |
| `examples` | Few-shot translation examples demonstrating project style |
| `orphanScan` | Per-layer config for orphan detection: `ignorePatterns` (glob patterns for keys to skip), `includeParentLayer` (also scan shared root code for key usage in monorepos). Keys are layer names from `list_locale_dirs`. Each layer automatically scans from its own root directory |
| `reportOutput` | `true` for default `.i18n-reports/` dir, or a string for a custom path. Diagnostic tools write full output to disk and return only a summary in the MCP response |
| `samplingPreferences` | Override model preferences for `translate_missing` sampling. See [Model Selection](#model-selection-for-translations) |

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
  "translationPrompt": "Use professional but approachable tone. Preserve all {placeholders} and @:linked references exactly. Keep translations concise — button labels should be 1-2 words.",
  "localeNotes": {
    "de": "Informal German (du). Standard business tone.",
    "de-formal": "Formal German (Sie). Used by enterprise customers.",
    "en-us": "American English. Default reference locale.",
    "nl": "Dutch (je/jij). Informal. Resource = 'Resource' (NEVER 'Middel'). Booking = 'Boeking'.",
    "fr": "French. Use inclusive writing where practical."
  },
  "examples": [
    {
      "key": "common.actions.save",
      "de": "Speichern",
      "en-us": "Save",
      "note": "Concise, imperative"
    },
    {
      "key": "bookings.status.checked_in",
      "de": "Eingecheckt",
      "en-us": "Checked in",
      "note": "Past participle, not imperative"
    }
  ],
  "orphanScan": {
    "shared": {
      "ignorePatterns": ["common.datetime.**", "common.countries.*"]
    },
    "app-admin": {
      "ignorePatterns": ["admin.legacy.*"],
      "includeParentLayer": true
    }
  },
  "reportOutput": true,
  "samplingPreferences": {
    "hints": ["sonnet", "gpt-4o"],
    "intelligencePriority": 0.7,
    "speedPriority": 0.5,
    "costPriority": 0.3
  }
}
```

See [`playground/nuxt/.i18n-mcp.json`](playground/nuxt/.i18n-mcp.json) for a working example.

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

Set `DEBUG=1` to enable verbose logging to stderr.

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
