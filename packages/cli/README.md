# the-i18n-cli

[![npm version](https://img.shields.io/npm/v/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-cli)
[![License](https://img.shields.io/npm/l/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

CLI and core library for managing i18n translation files — supports Nuxt, Laravel, and any project with JSON or PHP locale files.

Read, write, search, rename, and remove translation keys across all locales and layers from your terminal. Auto-detects your framework, discovers monorepo structures, and handles the file I/O.

Part of [the-i18n-kit](https://github.com/fabkho/the-i18n-kit) monorepo. For MCP server usage, see [the-i18n-mcp](https://www.npmjs.com/package/the-i18n-mcp).

## Install

```bash
# Global install
npm install -g the-i18n-cli

# Or use directly with npx
npx the-i18n-cli --help
```

## Quick Start

```bash
the-i18n-cli missing                         # Find missing translations
the-i18n-cli search --query "save"           # Search keys and values
the-i18n-cli write --layer root --translations '{"common.btn.ok": {"en": "OK", "de": "OK"}}'
the-i18n-cli translate-key --layer root --key common.btn.save --sourceLocale en-US --sourceValue "Save"
the-i18n-cli translate --layer root --provider openai --model gpt-4o-mini   # Auto-translate missing keys
the-i18n-cli remove-orphans                  # Find orphan keys (dry-run by default)
the-i18n-cli check                           # Find used-but-undefined keys (non-zero exit — CI gate)
```

## Commands

| Command | Description |
|---------|-------------|
| `get` | Read translation values for specific keys |
| `write` | Write translation keys (`add` / `update` / `upsert` mode, default: `upsert`) |
| `add` | Add new translation keys (skips keys that already exist) |
| `update` | Update existing keys (skips keys that do not exist) |
| `missing` | Find keys missing in target locales |
| `search` | Search keys and values |
| `remove` | Remove keys from all locale files in a layer |
| `rename` | Rename/move a key across all locale files |
| `translate` | Find missing translations and translate them via LLM (see Translation Modes). Also available as `translate-missing`, matching the MCP tool name |
| `translate-key` | Translate one source key into target locales; can overwrite stale values |
| `remove-orphans` | Find and remove keys not referenced in source code (dry-run by default) |
| `check` | Find keys referenced in code but defined in no consumed locale layer — the inverse of `remove-orphans`. Exits non-zero when any are found, so it can gate CI. Dynamically built keys are reported as uncertain, never as hard findings |
| `find-duplicates` | Find keys defined in both a shared layer and a consuming child layer (with divergence detection) |
| `scaffold` | Create empty locale files for new languages |

Run `the-i18n-cli <command> --help` for per-command options.

### Common Flags

| Flag | Description |
|------|-------------|
| `-d, --projectDir <dir>` | Project directory (default: cwd) |
| `--json` | Output as JSON (default when piped) |
| `--dryRun` | Preview changes without writing |
| `--output-file <path>` | `missing` / `remove-orphans` / `check`: write the full report to a file, return only a summary |

## Translation Modes

`translate` and `translate-key` run in one of two modes — every result reports which one ran (`mode: "provider" | "agent" | "dry-run"`).

**Provider mode** — pass `--provider` (`openai`, `anthropic`, or `google`) and `--model`; the API key comes from `--apiKey` or the provider's env var (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`). The CLI calls the LLM directly and writes validated results:

```bash
the-i18n-cli translate --layer root --provider google --model gemini-2.5-flash
the-i18n-cli translate --layer root --targets de-DE,fr-FR --batchSize 25 --provider openai --model gpt-4o-mini
```

For an OpenAI-compatible gateway, a local model or a proxy, add `--baseUrl` — or set `I18N_BASE_URL`, or `providerBaseUrl` in `.i18n-mcp.json`, in that order of precedence:

```bash
the-i18n-cli translate --layer root --provider openai --model llama3 --baseUrl http://localhost:11434/v1
```

`google` has no endpoint override, so a base URL with it is rejected as a configuration error rather than silently ignored.

**Agent mode** — no `--provider` given. Nothing is translated: keys are reported as `skipped` with reason `no-provider`, and the result explains how to enable provider mode. (In the MCP server, agent mode instead returns fallback contexts for the host agent — see [the-i18n-mcp](https://www.npmjs.com/package/the-i18n-mcp).)

### Result contract

Translate results account for every key:

- `translated` — keys written
- `wouldTranslate` — `--dryRun` only: keys that would be translated
- `failed` — with a reason: `provider-error`, `omitted-by-model`, `truncated`, `placeholder-mismatch`, `plural-mismatch`, `write-error`
- `skipped` — with a reason: `no-provider`, `already-translated`, `protected-locale`
- Invariant: `missing = translated + wouldTranslate + failed + skipped`

Translations are validated before writing: placeholder parity per vue-i18n plural variant (`{placeholders}`, `@:linked.refs`; `:params` for PHP) and plural variant-count parity with the source. Failing values are rejected into `failed` instead of written.

Locales listed in `protectedLocales` (see Project Config) are excluded from default translate targets and reported as `skipped` with reason `protected-locale`; naming one explicitly in `--targets` overrides the protection with a warning.

## Supported Frameworks

| Framework | Locale Format | Auto-Detection |
|-----------|--------------|----------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` |
| **Laravel** (9+) | PHP arrays | `artisan`, `composer.json`, `lang/` |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` |

For projects that aren't Nuxt or Laravel, add a `.i18n-mcp.json`:

```json
{
  "defaultLocale": "en",
  "localeDirs": ["src/locales"]
}
```

## Programmatic API

The CLI also exports all operations as a library for use in other tools:

```ts
import { detectConfig, getMissingTranslations, addTranslations, translateKey } from 'the-i18n-cli'

const config = await detectConfig('/path/to/project')
const missing = await getMissingTranslations({ projectDir: '/path/to/project' })

await translateKey({
  projectDir: '/path/to/project',
  layer: 'root',
  key: 'common.actions.save',
  sourceLocale: 'en-US',
  sourceValue: 'Save',
  targetLocales: 'all',
  overwrite: true,
})
```

## Project Config

Drop a `.i18n-mcp.json` at your project root for project-specific context:

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

See the [full config reference](https://github.com/fabkho/the-i18n-kit#project-config) for all options. `samplingPreferences` is deprecated and ignored (accepted for backward compatibility) — configure a provider instead.

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
