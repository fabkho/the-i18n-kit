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
the-i18n-cli init                            # Create .i18n-mcp.json from framework detection
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
| `init` | Create a schema-valid `.i18n-mcp.json` from framework detection. Non-interactive; refuses to overwrite without `--force` |
| `get` | Read translation values for specific keys |
| `write` | Write translation keys (`add` / `update` / `upsert` mode, default: `upsert`) |
| `add` | Add new translation keys (skips keys that already exist) |
| `update` | Update existing keys (skips keys that do not exist) |
| `missing` | Find keys missing in target locales |
| `status` | Translation coverage per locale and per layer, with one overall percentage |
| `search` | Search keys and values |
| `remove` | Remove keys from all locale files in a layer |
| `rename` | Rename/move a key across all locale files |
| `translate` | Find missing translations and translate them via LLM (see Translation Modes). Also available as `translate-missing`, matching the MCP tool name |
| `translate-key` | Translate one source key into target locales; can overwrite stale values |
| `remove-orphans` | Find and remove keys not referenced in source code (dry-run by default) |
| `check` | Find keys referenced in code but defined in no consumed locale layer — the inverse of `remove-orphans`. Exits non-zero when any are found, so it can gate CI. Dynamically built keys are reported as uncertain, never as hard findings |
| `find-duplicates` | Find keys defined in both a shared layer and a consuming child layer (with divergence detection) |
| `scan` | Find where translation keys are referenced in source, with file and line — use before renaming or removing a key |
| `scaffold` | Create empty locale files for new languages |

Run `the-i18n-cli <command> --help` for per-command options.

### Common Flags

| Flag | Description |
|------|-------------|
| `-d, --projectDir <dir>` | Project directory (default: cwd) |
| `--json` | Output as JSON (default when piped) |
| `--dryRun` | Preview changes without writing |
| `--output-file <path>` | `missing` / `remove-orphans` / `check`: write the full report to a file, return only a summary |

### Exit Codes and CI Gates

| Code | Meaning |
|------|---------|
| `0` | The run succeeded and no gate tripped |
| `1` | The run itself failed — bad API key, unreadable project, a translate run that translated nothing |
| `2` | The run succeeded but a gate tripped: findings exist and the tool worked |

Separating `1` from `2` lets a pipeline tell a broken setup apart from a project that simply has untranslated keys.

Gates are opt-in flags, so every invocation without one keeps the exit code it has today:

| Flag | Command | Trips when |
|------|---------|-----------|
| `--fail-on-missing` | `missing` | Any key is missing in a target locale |
| `--fail-on-orphans` | `remove-orphans` | Any orphan key is found (dry-run still applies) |
| `--fail-on-failed` | `translate` | Any key failed to translate |
| `--fail-under <n>` | `status` | Overall completion is below `n` percent |

```bash
the-i18n-cli missing --fail-on-missing          # exit 2 blocks the merge
the-i18n-cli remove-orphans --fail-on-orphans   # dry-run, but non-zero on findings
the-i18n-cli translate --fail-on-failed         # exit 2 when the run lost keys
the-i18n-cli status --fail-under 90             # ratchet coverage like test coverage
```

`translate` needs its own gate because exit `1` is reserved for a run that
translated *nothing*. A run that writes 795 keys and loses 141 is a success by
that measure: it exits `0`, and the partial result is committed like any other.
The failed keys are still missing, so re-running retries them — the gate is for
noticing that you need to.

Gates compose on one invocation, and a failed run outranks a tripped gate — exit `1` wins over exit `2`. When a gate trips, the JSON result gains a `gatesTripped` array naming it and reporting the observed value against the threshold; nothing else in the result changes, so existing consumers keep working:

```json
{
  "summary": { "totalMissingKeys": 12 },
  "gatesTripped": [
    { "name": "fail-on-missing", "counter": "totalMissingKeys", "direction": "above", "threshold": 0, "observed": 12 }
  ]
}
```

`check` is the exception: it gates unconditionally with exit `1`, because a key that renders raw in production is a defect rather than a threshold.

## Getting Started on a New Project

```bash
the-i18n-cli init            # writes .i18n-mcp.json
the-i18n-cli init --dry-run  # report what it would write, touch nothing
the-i18n-cli init --force    # overwrite an existing config
```

`init` detects the framework and writes **only what that framework cannot tell the tool itself**. On a Nuxt, Laravel, Vue or React project the locales, layers and default locale are resolved from the framework config on every run, so `init` deliberately does not copy them into `.i18n-mcp.json` — a generated copy is a second source of truth that drifts silently the day the framework config changes. What you get is the authoring context no adapter can derive:

```json
{
  "$schema": "https://raw.githubusercontent.com/fabkho/the-i18n-kit/main/packages/mcp/schema.json",
  "context": "",
  "glossary": {},
  "translationPrompt": "",
  "localeNotes": {}
}
```

A project with no recognised framework is the exception: the generic adapter cannot resolve anything without `localeDirs` and `defaultLocale`, so `init` probes the common locale directory layouts and writes what it finds. The reference locale is guessed as the **fullest** locale file rather than the alphabetically first, since a source locale is the one everything else is translated from.

The result reports which adapter matched and with what confidence, so you can tell why Nuxt was chosen over generic. `init` is non-interactive, so it runs unattended in a devcontainer or CI bootstrap, and it refuses to overwrite an existing config unless you pass `--force`. Even then it preserves any `localeDirs`, `defaultLocale` and `locales` already in the file — `--force` refreshes the scaffolding, it does not discard your locale wiring.

## Coverage

```bash
the-i18n-cli status                  # per locale and per layer, plus one overall number
the-i18n-cli status --layer root     # one layer
the-i18n-cli status --fail-under 90  # CI gate: exit 2 below the threshold
```

One call replaces calling `missing` per layer and counting keys yourself:

```json
{
  "summary": {
    "totalKeys": 8, "translatedKeys": 3, "missingKeys": 4, "emptyKeys": 1,
    "completionPercent": 37.5,
    "protectedLocales": ["de-formal"], "localesChecked": 2
  }
}
```

**Empty strings count as untranslated.** A scaffolded key nobody filled renders as a blank, so counting it as complete would let a locale read as done while showing gaps in the UI — consistent with how `missing` already treats them. They are reported separately from `missing` so you can tell a scaffold-and-forget locale from an untouched one.

**Protected locales are reported but excluded from the overall figure**, in both the project and per-layer numbers. They are maintained by hand, so counting their gaps as project debt makes a healthy project read as failing and moves a number nobody can act on.

The full per-locale and per-layer arrays grow with the project, so pass `--output-file` to write them to disk and get back only the summary.

## Referring to Locales

Anywhere a locale is named — `--ref`, `--targets`, `protectedLocales`, the keys of a `write_translations` payload — you may use the locale's **code**, its **language tag**, or its **file name** (extension included). Resolution takes them in that order.

**Prefer the code.** Codes are unique by construction; language tags are not. A project can declare an informal and a formal German that both carry `language: "de-DE"`, in which case `de-DE` is ambiguous — it resolves to the first match, and that depends on the order of your framework's locale array. The precedence rule guarantees only that a locale's own code is never shadowed by a *different* locale's language tag.

A ref that matches nothing is reported rather than silently dropped:

```json
{
  "written": ["common.save"],
  "filesWritten": 2,
  "unresolvedLocales": [
    { "ref": "de-DE-formal", "keys": ["common.save"], "suggestion": "Did you mean \"de-formal\" or \"de-DE\" or \"de-DE-formal.json\"?" }
  ]
}
```

`unresolvedLocales` is the only reliable signal that a write did less than you asked: the key still appears in `written` because the other locales succeeded, and `filesWritten` is short by one. A ref matching several locales is reported the same way under `ambiguousLocales`, naming every candidate and the one that was used. Both fields are absent when every ref resolves uniquely, so a clean write is byte-for-byte what it always was.

Note that a locale's `file` must be given with its extension (`de-DE-formal.json`); the bare stem is not a valid ref.

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

**The scan never removes a key it is unsure about.** Dynamic references are detected, not ignored: a key that *could* be produced by a template pattern, a concatenated prefix or an ambiguous probe is classified as used and left alone. Deletion is reserved for keys with no evidence of use anywhere in a consuming app. On a real 8,000-key project roughly 12% of keys land in the protective buckets — that is the scan working, not failing.

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

**Recommended code style — anchor dynamic keys, don't avoid them.** Dynamic keys are tracked and are often the right design; what matters is that the *namespace* stays literal at the call site:

```ts
t(`${prefix}.title`)                          // widens to any key ending .title
t(`components.integrations.${type}.title`)    // widens to one segment under a known namespace
```

Both are counted as used, but the first suppresses every `.title` key in the project — on a large catalog that can be hundreds of keys the scan can no longer audit. Keeping a literal leading segment costs nothing and keeps the report meaningful. Literal key maps (`const KEYS = { draft: 'x.status.draft' } as const`) are the fully-static alternative where the set is closed.

Prefixes assembled in another scope defeat this even when they are literal — a `computed` returning `'a.b.' + x` reaches the call site as an opaque variable. Inline the namespace instead of the whole key.

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

### Read, not guessed

Where a project already declares its locales, the adapter reads that file rather than inferring from directory order:

| Setup | Read from | Gives |
|---|---|---|
| next-intl | `src/i18n/routing.ts` — `defineRouting({ ... })` | `locales`, `defaultLocale` |
| next-translate | `i18n.js` | `locales`, `defaultLocale` |
| Next.js Pages Router | `next.config.{ts,js,mjs}` — `i18n: { ... }` | `locales`, `defaultLocale` |
| Vue + `@intlify/unplugin-vue-i18n` | `vite.config.{ts,js}` — the plugin's `include` | locale directories |

These files are executed, so a `next.config.js` wrapped in `withNextIntl(...)` or `withSentryConfig(...)` may fail without the right environment. That is never fatal: the CLI warns and falls back to the directory probing above, exactly as it behaved before it could read them.

A value you declare yourself always wins over both. To pin the reference locale regardless of what any framework config says:

```ts
export default defineI18nKitConfig({
  defaultLocale: 'en',
  localeDirs: ['src/locales'],
})
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

Project-specific context goes in `i18n-kit.config.ts` at your project root, where the editor checks it:

```ts
import { defineI18nKitConfig } from 'the-i18n-cli/config'

export default defineI18nKitConfig({
  context: 'B2B SaaS booking platform',
  glossary: {
    Booking: "Core concept. Dutch: 'Boeking'.",
  },
  protectedLocales: ['en-us', 'de-formal'],
})
```

Read directly, with no build step — a `protectedLocales` entry that only takes effect once something has been built is a locale that quietly goes unprotected in a fresh checkout. `.ts`, `.mts`, `.js`, `.mjs` and `.cjs` all work, and the file is looked up from the working directory upwards, the way `eslint` and `tsconfig` resolve theirs.

`.i18n-mcp.json` accepts the same keys and remains supported:

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
  "protectedLocales": ["en-us", "de-formal"]
}
```

Use one or the other. Both may be present, but declaring the same key in both is an error naming both files rather than a silent precedence rule.

See the [full config reference](https://github.com/fabkho/the-i18n-kit#project-config) for all options. `samplingPreferences` is deprecated and ignored (accepted for backward compatibility) — configure a provider instead.

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
