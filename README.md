# the-i18n-kit

[![CI](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

**Translation file management for developers and AI agents.** Find missing keys, remove dead ones, rename across all locales at once — from the terminal or from inside your AI coding session.

---

## The Problem

GUI tools like [BabelEdit](https://www.codeandweb.com/babeledit) already make i18n management easier — a visual editor beats hunting through raw JSON. But they still leave a gap:

- You add a new UI component and need to create the translation key in **every locale file** — manually, in a separate tool
- Over time, removed components leave behind **hundreds of orphan keys** nobody uses — no GUI tool detects these from source code
- You rename a key and have to hunt it down across **30+ JSON files**
- Your AI agent writes `$t('some.key')` but has no idea where the locale files live, what already exists, or which layer the key belongs to
- Large tool outputs (missing keys, orphan reports) flood your agent's context window and freeze the session

The-i18n-kit fills the gap: automation from the terminal and a native integration for AI agents — so translation maintenance becomes part of your normal development workflow, not a separate step.

## How It Works

The-i18n-kit auto-detects your project structure (Nuxt, Laravel, or any generic setup), then gives you two interfaces:

**A CLI** for direct use in the terminal:
```bash
the-i18n-cli missing              # what's not translated yet?
the-i18n-cli orphans              # what keys are dead code?
the-i18n-cli rename old.key new.key   # rename across all locales at once
the-i18n-cli cleanup              # remove orphan keys (dry-run by default)
```

**An MCP server** that plugs into AI coding agents (Cursor, Claude, VS Code, Zed). Your agent can read, write, and maintain translation files as part of its normal workflow — with your glossary, tone notes, and layer rules loaded as context so translations stay consistent.

```
Agent adds $t('booking.confirm.title')
  → calls add_translations (writes to all locales using its own LLM)
  → calls translate_missing (fills remaining locales via MCP sampling)
Done. All 28 locales updated, consistent terminology, no manual work.
```

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [**the-i18n-cli**](./packages/cli) | [![npm](https://img.shields.io/npm/v/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-cli) | CLI + core library — install globally |
| [**the-i18n-mcp**](./packages/mcp) | [![npm](https://img.shields.io/npm/v/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp) | MCP server for AI agents |

---

## Quick Start

### CLI

```bash
npm install -g the-i18n-cli

the-i18n-cli detect                    # verify project is auto-detected
the-i18n-cli missing                   # find missing translations
the-i18n-cli orphans                   # find unused translation keys
the-i18n-cli search --query "save"     # search keys and values
the-i18n-cli cleanup                   # remove orphan keys (dry-run by default)
```

→ [Full CLI documentation](./packages/cli/README.md)

### MCP Server

Add to your MCP host (VS Code, Cursor, Claude Desktop, Zed):

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

→ [Full MCP documentation](./packages/mcp/README.md)

---

## Supported Frameworks

| Framework | Locale Format | Auto-Detection |
|-----------|--------------|----------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` |
| **Laravel** (9+) | PHP arrays | `artisan`, `composer.json`, `lang/` |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` |

## Using with Any Framework (Generic Adapter)

For projects that aren't Nuxt or Laravel, create a `.i18n-mcp.json` at your project root:

```json
{
  "defaultLocale": "en",
  "localeDirs": ["src/locales"],
  "locales": ["en", "de", "fr", "es"]
}
```

All tools work immediately.

| Field | Required | Description |
|-------|----------|-------------|
| `defaultLocale` | ✅ | Your reference locale — the source of truth for key completeness |
| `localeDirs` | ✅ | Paths to locale directories (relative to project root) |
| `locales` | ❌ | Explicit locale codes. If omitted, auto-discovered from filenames |

`localeDirs` supports both flat and layered setups:

```json
// Flat: all locale files in one directory
"localeDirs": ["src/i18n"]

// Layered: multiple directories with named layers
"localeDirs": [
  { "path": "src/i18n/common", "layer": "common" },
  { "path": "src/i18n/dashboard", "layer": "dashboard" }
]
```

> 💡 **Tip:** Let your AI agent generate this config. Ask it to inspect your locale file layout and create the `.i18n-mcp.json` — takes seconds.

---

## Project Config

Drop a `.i18n-mcp.json` at your project root to give agents (and the CLI) project context:

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

This context is automatically loaded by `detect_i18n_config` before any translation work, so agents use the right terminology and tone across all locales.

<details>
<summary><strong>All config options</strong></summary>

| Field | Purpose |
|-------|---------|
| `framework` | Force framework detection: `"nuxt"`, `"laravel"`, or `"generic"` |
| `context` | Free-form project background for the agent |
| `layerRules` | Rules for which layer a new key belongs to |
| `glossary` | Term dictionary for consistent translations |
| `translationPrompt` | System prompt for all translation requests |
| `localeNotes` | Per-locale instructions (formality, terminology) |
| `examples` | Few-shot translation examples |
| `orphanScan` | Per-layer ignore patterns for orphan detection |
| `reportOutput` | `true` or path — write large tool output to disk instead of returning it inline |
| `samplingPreferences` | Override model preferences for `translate_missing` |
| `localeDirs` | Locale directories for the generic adapter |
| `defaultLocale` | Default locale code (required for generic adapter) |
| `locales` | Explicit list of locale codes |

</details>

---

## Agent Translation Workflow

When an AI agent builds a feature and adds new translation keys:

1. **Agent adds `$t('some.key')`** to the Vue/Blade component
2. **Agent calls `detect_i18n_config`** → loads `.i18n-mcp.json` (context, glossary, layerRules) into its session
3. **Agent calls `add_translations`** — writes translations for all locales at once using the glossary and context it just loaded. The agent's own LLM does the translation work. No separate sampling involved.
4. **Agent calls `translate_missing`** → MCP sampling fills any locales the agent didn't cover via a separate LLM call.

The `add-feature-translations` MCP prompt codifies this as a reusable workflow. It also checks for duplicate keys via `search_translations` before writing.

> **`add_translations` vs `translate_missing`:** `add_translations` is a pure write tool — takes a `{key: value}` map and writes it, no LLM involved. `translate_missing` is where sampling happens: reads the reference locale, builds a prompt from glossary + localeNotes + examples, and calls the LLM to fill gaps across all other locales.

---

## Handling Large Outputs

Tools like `find_orphan_keys` and `get_missing_translations` can return large payloads. Pass `--output-file` (CLI) or `outputFile` (MCP) to write the full report to disk and get only a compact summary back:

```bash
the-i18n-cli orphans --output-file /tmp/orphans.json
# → Wrote report to: /tmp/orphans.json
# → { orphanCount: 1103, filesScanned: 2526, ... }
```

```json
// MCP call
{ "tool": "find_orphan_keys", "arguments": { "outputFile": "/tmp/orphans.json" } }
// → { "reportFile": "/tmp/orphans.json", "summary": { ... } }
```

Alternatively, set `reportOutput: true` in `.i18n-mcp.json` to always write reports to `.i18n-reports/` in the project root.

---

## How Orphan Detection Works

The scanner finds translation key references in source code:

**Nuxt/Vue patterns:** `$t('key')`, `t('key')`, `$tc('key')`, `i18n.t('key')`, template literals with `$t`

**Laravel/PHP patterns:** `__('key')`, `trans('key')`, `@lang('key')`, `Lang::get('key')`, `trans_choice('key')`

**Bare string candidates:** Any quoted dot-notation string in source (`'some.key'`, `"some.key"`) is treated as a potential key reference — regardless of whether it's inside a `t()` call. This catches patterns like `{ label: 'common.actions.save', i18n: true }` and non-standard i18n call styles.

**Dynamic key handling:**
- Template literals: `` $t(`status.${val}`) `` → matches all keys under `status.*`
- String concatenation: `t('prefix.' + var)` → matches all keys under `prefix.*` (single-line and multiline forms both detected)
- Keys matched by dynamic patterns are reported as "uncertain" separately and excluded from cleanup

**Scan scope:**
- Scans recursively from the project root — all source files, all layers
- Standard ignore dirs (`node_modules`, `.nuxt`, `.output`, `dist`) excluded automatically

---

## Development

```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm lint           # ESLint across all packages
pnpm typecheck      # TypeScript check all packages
```

Set `DEBUG=1` to enable verbose logging to stderr.

---

## Roadmap

- [ ] `find_hardcoded_strings` — detect user-facing strings not wrapped in translation calls
- [ ] `move_translations` — move keys between layers
- [ ] Glossary validation — check translations against glossary terms
- [ ] Flat JSON support — `flatJson: true` in vue-i18n config
- [ ] Pluralization support — vue-i18n plural forms and Laravel `trans_choice`

## License

[MIT](./LICENSE)
