# the-i18n-cli

[![npm version](https://img.shields.io/npm/v/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-cli)
[![License](https://img.shields.io/npm/l/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

CLI and core library for managing i18n translation files — supports Nuxt, Laravel, Vue, React/Next.js, and any project with JSON or PHP locale files.

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

To reach an endpoint that speaks the same protocol — a gateway, a self-hosted model server, a proxy — add `--baseUrl`, or set `I18N_BASE_URL`, or `providerBaseUrl` in `.i18n-mcp.json`, in that order of precedence:

```bash
the-i18n-cli translate --layer root --provider openai --model llama3 \
  --baseUrl http://localhost:11434/v1 --apiKey unused
```

An API key is still required even when the endpoint ignores it — pass any placeholder for a local server. This overrides the endpoint only, so providers that also change the request shape or auth header (Azure OpenAI among them) are not reachable this way.

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

## How Orphan Detection Works

`remove-orphans` and `check` share a line-based static scanner. Knowing exactly what it can and cannot see is essential before deleting keys.

**Usage evidence the scanner recognizes:**

| Class | Example | Effect |
|---|---|---|
| Static keys | `t('a.b.c')`, `$te('a.b')`, `__('a.b')` | exact match |
| Template patterns | `` t(`a.b.${x}`) `` | keys matching `a.b.<one segment>` count as used (`dynamic-matched`) |
| Same-file const prefixes | `const base = 'a.b'` + `` t(`${base}.title`) `` | resolved to the exact key |
| Unresolved variable segments | `` t(`${somePath}.title`) `` | conservatively matches **any** `*.title` key |
| Concat prefixes | `'a.b.' + x`, `x + '.label'` | pattern-matched like templates (single-segment prefixes included) |
| Multiline calls | prefix on a different line than `t(` | caught by bare-string fallbacks (heuristic) |
| Multi-app scoping | key in a shared layer | usage counts only from apps that consume the layer; cross-app usages are reported as `misplacedUsages`, never removed |

**Classification buckets** — only `orphanKeys` is ever removed; everything else is protective:

- `orphanKeys` — no evidence of use in any consuming app: safe to remove
- `dynamic-matched` — a dynamic pattern could produce this key: counted as used
- `uncertainKeys` — evidence is ambiguous (e.g. `$te`-only probes): never removed
- `ignored` — matched by `orphanScan.ignorePatterns`: never scanned
- `misplacedUsages` — used only from non-consuming apps: never removed

**Known blind spots** (declare these families in `orphanScan.ignorePatterns`):

- Prefixes stored in **cross-file** constants, class fields, or object properties typed as plain strings (`obj.translationPath`) — the scanner widens these to conservative suffix patterns, but treat such families as declared-dynamic
- Keys composed at runtime from data (API responses, database values, enums built dynamically)
- Keys referenced only outside the scanned source (backend responses, external configs, docs)

**Recommended code style for exact scanning:** prefer full literal keys, or literal key maps (`const KEYS = { draft: 'x.status.draft', ... } as const`) over string-building — every key stays greppable and the scanner needs no heuristics. Vue projects can enforce this with `@intlify/eslint-plugin-vue-i18n`'s `no-dynamic-keys` rule.

`remove-orphans` is dry-run by default; run removals as a reviewed MR and treat the report's `uncertainKeys`/`dynamicKeys` sections as the audit trail.

## Supported Frameworks

| Framework | Locale Format | Auto-Detection | Locale Directories Probed |
|-----------|--------------|----------------|---------------------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` | `i18n/locales/` per app and per layer; honours each layer's `langDir` (default `locales`) |
| **Laravel** (9+) | PHP arrays or JSON | `artisan`, `composer.json`, `lang/` | `lang/` or `resources/lang/` — PHP subdirectories (`lang/en/*.php`) or flat JSON (`lang/en.json`) |
| **Vue** (SPA, v3) | JSON | `vue` in dependencies without Nuxt; `vue-i18n` raises confidence | `src/locales`, `locales`, `src/i18n/locales`, `i18n/locales`, `src/plugins/i18n/locales`, `src/i18n` — or a `localeDir`/`messages` path read out of `src/i18n/index.{ts,js}`, `src/plugins/i18n.{ts,js}`, `src/i18n.{ts,js}`, `i18n.{ts,js}` |
| **React / Next.js** | JSON | `next`, or `react` + `react-dom`, without Vue/Nuxt; `next-intl`, `next-translate`, `next-i18next`, `react-i18next` or `react-intl` raises confidence | `messages`, `public/locales`, `locales`, `src/i18n`, `src/locales`, `i18n` — namespaced (`messages/en/common.json`) or flat (`locales/en.json`). A `next.config.{ts,js,mjs}` using `createNextIntlPlugin` or `next-translate` pins the directory directly |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` | Exactly the paths listed in `localeDirs` |

Detection is confidence-scored: the highest-scoring adapter wins, and a `.i18n-mcp.json` carrying both `localeDirs` and `defaultLocale` outscores framework inference. Set `"framework": "vue"` (or any adapter name) to force one adapter.

The Vue and React/Next adapters resolve a single locale directory and take the alphabetically first discovered locale as the default. To pin a different reference locale, use `localeDirs` + `defaultLocale`:

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
