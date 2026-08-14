# the-i18n-kit

[![CI](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
[![Glama score](https://glama.ai/mcp/servers/fabkho/the-i18n-kit/badges/score.svg)](https://glama.ai/mcp/servers/fabkho/the-i18n-kit)

**Translation file management for developers and AI agents.** Find missing keys, remove dead ones, rename across all locales at once — from the terminal or from inside your AI coding session.

---

## The Problem

Managing i18n at scale is tedious:

- You add a new UI component and need to create the translation key in **every locale file** — manually
- Over time, removed components leave behind **hundreds of orphan keys** nobody uses
- You rename a key and have to hunt it down across **30+ JSON files**
- Your AI agent writes `$t('some.key')` and has no idea where the locale files live or what already exists — and reading whole locale files to find out floods its context window with thousands of lines it doesn't need

The-i18n-kit gives you and your agent purpose-built tools for exactly these operations: targeted reads, compact summaries, and validated writes across all locales at once.

## How It Works

The-i18n-kit auto-detects your project structure (Nuxt, Laravel, Vue, React/Next.js, or any generic setup), then gives you two interfaces:

**A CLI** for direct use in the terminal:
```bash
the-i18n-cli missing              # what's not translated yet?
the-i18n-cli remove-orphans      # what keys are dead code? (dry-run by default)
the-i18n-cli check               # what keys are used but never defined? (non-zero exit — CI gate)
the-i18n-cli rename --layer root --oldKey old.key --newKey new.key   # rename across all locales at once
the-i18n-cli translate-key --layer root --key common.save --sourceLocale en-US --sourceValue "Save"  # update one key and translate targets
the-i18n-cli translate --layer root --provider google --model gemini-2.5-flash  # auto-translate all missing keys
```

**An MCP server** that plugs into AI coding agents (Cursor, Claude, VS Code, Zed). Your agent can read, write, and maintain translation files as part of its normal workflow — with your glossary, tone notes, and layer rules loaded as context so translations stay consistent.

```
Agent adds $t('booking.confirm.title')
  → calls write_translations (writes exact values the agent provides)
  → calls translate_missing (fills remaining locales — see Translation Modes below)
Done. All 28 locales updated, consistent terminology, no manual work.

Agent changes wording for an existing key
  → calls translate_key with the source locale/value
  → target locales are refreshed, including stale existing values when overwrite=true
```

---

[![the-i18n-kit MCP server](https://glama.ai/mcp/servers/fabkho/the-i18n-kit/badges/card.svg)](https://glama.ai/mcp/servers/fabkho/the-i18n-kit)

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [**the-i18n-cli**](./packages/cli) | [![npm](https://img.shields.io/npm/v/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-cli) | CLI + core library — install globally |
| [**the-i18n-mcp**](./packages/mcp) | [![npm](https://img.shields.io/npm/v/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-mcp) | MCP server for AI agents |
| [**@the-i18n-kit/nuxt**](./packages/nuxt) | [![npm](https://img.shields.io/npm/v/@the-i18n-kit/nuxt?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/nuxt) | Nuxt module — publishes the layer graph and locale table Nuxt already resolved |

---

## Quick Start

### CLI

```bash
npm install -g the-i18n-cli

the-i18n-cli init                      # create .i18n-mcp.json from framework detection
the-i18n-cli missing                   # find missing translations
the-i18n-cli search --query "save"     # search keys and values
the-i18n-cli remove-orphans            # find unused translation keys (dry-run by default)
the-i18n-cli translate --layer root --provider openai --model gpt-4o-mini   # auto-translate missing keys
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

## Dead Key Detection

`remove-orphans` finds translation keys no source file references. The hard part is not finding unused keys — it is not deleting keys that only *look* unused, and the scan is built around that.

**Dynamic references are detected, not ignored.** A key reachable through `` t(`a.b.${type}.title`) ``, a concatenated prefix, or an ambiguous `$te()` probe is classified as **used** and never removed. Keys owned by a shared layer but referenced from an app that doesn't consume it are reported as `misplacedUsages` and never removed either. Only keys with no evidence of use anywhere in a consuming app are offered for deletion — and `remove-orphans` is dry-run by default.

Every report separates the buckets, so a cleanup is reviewable rather than a leap of faith:

| Bucket | Removed? |
|---|---|
| `orphanKeys` — no evidence of use | yes, on an explicit non-dry run |
| `dynamic-matched` — a dynamic pattern could produce it | no |
| `uncertainKeys` — evidence is ambiguous | no |
| `misplacedUsages` — used only from a non-consuming app | no |
| `ignored` — matched `orphanScan.ignorePatterns` | no |

On a real 8,000-key monorepo about 12% of keys land in the protective buckets. That is the scan being conservative on purpose.

→ [How the scanner works, what it can and cannot see](./packages/cli/README.md#how-orphan-detection-works)

---

## Translation Modes

The translate operations (`translate` / `translate-key` in the CLI, `translate_missing` / `translate_key` in the MCP server) run in one of two modes. Every result reports which mode ran (`mode: "provider" | "agent" | "dry-run"`).

### Provider mode

The kit calls an LLM provider directly — OpenAI, Anthropic, or Google.

**CLI:** pass `--provider` and `--model`; the API key comes from `--apiKey` or the provider's env var (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`):

```bash
the-i18n-cli translate --layer root --provider google --model gemini-2.5-flash
```

**MCP server:** set environment variables on the server process:

| Variable | Value |
|----------|-------|
| `I18N_PROVIDER` | `openai`, `anthropic`, or `google` |
| `I18N_MODEL` | Model name (e.g. `gemini-2.5-flash`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | API key matching the provider |
| `I18N_BASE_URL` | Optional provider base URL (see below) |

Partial configuration (e.g. provider without model or key) logs a warning to stderr and falls back to agent mode — a misconfigured server never surprises callers per-request.

### Custom provider endpoints

Point the `openai` or `anthropic` provider at any endpoint that speaks the same protocol — a gateway such as OpenRouter or LiteLLM, a self-hosted model server, or a corporate proxy. Three sources, highest precedence first:

```bash
the-i18n-cli translate --layer root --provider openai --model llama3 \
  --baseUrl http://localhost:11434/v1 --apiKey unused
```

| Source | Scope |
|--------|-------|
| `--baseUrl` | One invocation |
| `I18N_BASE_URL` | The environment, including the MCP server process |
| `providerBaseUrl` in `.i18n-mcp.json` | The whole project, shared through the repo |

An API key is still required even when the endpoint ignores it — pass any placeholder for a local server.

This overrides the endpoint only. Providers that also change the request shape or auth header, Azure OpenAI among them, need their own client and are not reachable this way.

A blank `--baseUrl` or `I18N_BASE_URL` counts as unset, so an exported-but-empty variable can't silently disable an endpoint configured further down the chain. A blank `providerBaseUrl` in the config file is rejected at load time instead — unlike a shell variable, it can't get there by accident.

The `google` provider has no endpoint override — passing a base URL with it is rejected as a configuration error rather than ignored.

### Agent mode

The default in MCP hosts — no provider configured. The translate tools return per-locale `fallbackContexts` (source values plus glossary, style, and locale notes); the calling agent translates them inline and persists the results via `write_translations`. In the CLI, agent mode means nothing is translated: keys are reported as `skipped` with reason `no-provider`.

The MCP `discover` tool reports the active mode as `translationMode` (plus `translationProvider` and `translationModel` in provider mode), so you can verify the configuration without triggering a translation.

### Result contract

Translate results account for every key:

- `translated` — keys written
- `wouldTranslate` — dry runs only: keys that would be translated
- `failed` — with a reason: `provider-error`, `omitted-by-model`, `truncated`, `placeholder-mismatch`, `plural-mismatch`, `write-error`
- `skipped` — with a reason: `no-provider`, `already-translated`, `protected-locale`
- Invariant: `missing = translated + wouldTranslate + failed + skipped`

Translations are validated before writing: placeholder parity is checked **per vue-i18n plural variant** (`{placeholders}`, `@:linked.refs`; `:params` for PHP), and the number of pipe-separated plural variants must match the source. Values that fail validation are rejected into `failed` instead of written.

Provider failures are classified: authentication errors (401/403) abort the whole run immediately with a single clear error instead of failing key by key, rate limits are retried with backoff, and responses cut off at the token limit are detected via the provider's finish reason and reported as `truncated` (reduce `batchSize`). The CLI exits non-zero when a run translates nothing and has failures, so CI can gate without parsing JSON.

### Protected locales

Human-maintained locales can be excluded from automatic translation via `protectedLocales` in `.i18n-mcp.json`:

```json
{
  "protectedLocales": ["en-US", "en-GB", "de-DE-formal"]
}
```

Protected locales are excluded from the default target set of both translate operations and reported as `skipped` with reason `protected-locale`. Explicitly naming a protected locale in `targetLocales` overrides the protection with a warning. `discover` lists the resolved protected locales.

---

## CI / Automation

Auto-translate missing keys and find orphans in CI — no manual work. Runs on every MR/PR that touches locale files or source code.

Provider-agnostic. Bring your own API key for OpenAI, Anthropic, or Google.

### Gating on findings

Turn findings into exit codes with opt-in gates, so a pipeline blocks a merge without parsing JSON:

```bash
the-i18n-cli missing --fail-on-missing          # exit 2 when any key is missing
the-i18n-cli remove-orphans --fail-on-orphans   # exit 2 when any orphan is found
the-i18n-cli translate --fail-on-failed         # exit 2 when the run lost keys
```

`translate` needs its own gate: exit `1` means the run translated *nothing*, so a
run that writes most keys and loses the rest counts as a success and commits the
partial result. The lost keys stay missing and a re-run retries them.

| Code | Meaning |
|------|---------|
| `0` | The run succeeded and no gate tripped |
| `1` | The run itself failed — bad API key, unreadable project, a translate run that translated nothing |
| `2` | The run succeeded but a gate tripped |

The split between `1` and `2` is what lets a job distinguish a missing API key from a project that simply has untranslated keys. Gates compose on one invocation, a failed run outranks a tripped gate, and a tripped gate is named in the result's `gatesTripped` array with its observed value and threshold. Commands invoked without a gate flag keep exactly the exit codes they had before.

See the [CLI exit-code reference](./packages/cli/README.md#exit-codes-and-ci-gates) for the full table.

### GitHub Actions

```yaml
# .github/workflows/i18n.yml
name: i18n

on:
  pull_request:
    paths:
      - i18n/locales/en.json
      - components/**/*.vue

jobs:
  translate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: fabkho/the-i18n-kit@main
        with:
          provider: google
          model: gemini-2.0-flash
          api_key: ${{ secrets.GEMINI_API_KEY }}
          layer: common
```

The action translates missing keys and **creates a pull request** with the changes (branch `i18n/translate-missing-<timestamp>` by default). The job fails when every key failed to translate.

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `provider` | ✅ | — | `openai`, `anthropic`, or `google` |
| `model` | ✅ | — | Model name |
| `api_key` | ✅ | — | API key for the provider |
| `layer` | ✅ | — | Layer name (e.g. `common`, `dashboard`) |
| `locales` | — | all except source | Comma-separated target locales |
| `source_locale` | — | from `.i18n-mcp.json` | Reference locale |
| `keys` | — | all missing | Comma-separated keys to translate |
| `batch_size` | — | `50` | Keys per LLM call |
| `dry_run` | — | `false` | Preview without writing files |
| `working_directory` | — | `github.workspace` | Project root directory |
| `create_pr` | — | `true` | Create a PR with the translated files |
| `pr_branch` | — | `i18n/translate-missing-<timestamp>` | Branch name for the PR |
| `commit_message` | — | auto-generated | Custom commit message |
| `pr_title` | — | auto-generated | PR title |
| `github_token` | — | `GITHUB_TOKEN` | Token used to create the PR |
| `base_branch` | — | triggering branch | Base branch for the PR |
| `cli_version` | — | `latest` | the-i18n-cli version to install (`skip` to use a preinstalled CLI) |

Outputs: `translated_count`, `failed_count`, `pr_url`.

### GitLab CI

Three reusable jobs: `.i18n-translate`, `.i18n-cleanup`, and `.i18n-check`.

```yaml
# .gitlab-ci.yml
include:
  - remote: 'https://raw.githubusercontent.com/fabkho/the-i18n-kit/main/gitlab-ci.yml'

i18n-translate:
  extends: .i18n-translate
  variables:
    I18N_PROVIDER: google
    I18N_MODEL: gemini-2.0-flash
    I18N_API_KEY: $GEMINI_API_KEY
    I18N_LAYER: common
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - i18n/locales/en.json

i18n-cleanup:
  extends: .i18n-cleanup
  variables:
    I18N_LAYER: root
    I18N_FAIL_ON_ORPHANS: "true"   # optional: exit 2 when orphans are found
  # allow_failure: false           # optional: make orphans block the merge
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - components/**/*.vue
        - i18n/locales/*.json
    # Default-branch baseline — required for the MR Code Quality widget
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

i18n-check:
  extends: .i18n-check
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Translations are pushed to the MR branch. Orphan and undefined-key findings are emitted as a `gl-codequality.json` Code Quality artifact and surface in the MR's Code Quality widget. The widget diffs the MR report against the latest default-branch report — without a default-branch rule (no `changes:` filter) the widget stays blank. Artifacts (`.i18n-reports/`, `gl-codequality.json`) are retained for 7 days.

Every job decides its outcome from the CLI's exit code rather than by parsing counts out of the JSON result — reading result fields to decide pass/fail is what coupled earlier versions of these templates to undocumented output shapes. `0` is success, `1` means the run itself failed, `2` means a requested gate tripped.

`.i18n-cleanup` allows exit `2` only, so orphans surface as a yellow warning while a genuinely broken scan still fails the job red. Set `I18N_FAIL_ON_ORPHANS: "true"` to request the gate and `allow_failure: false` to make orphans block the merge. `.i18n-check` has no opt-in flag — it always exits `1` on findings, because a key that renders raw in production is a defect rather than a threshold, and it carries `allow_failure: true` by default (remove it to make it a gate).

Pushing back to the branch requires either the GitLab ≥ 17.2 project setting *"Allow Git push requests to the repository"* (job token) or a project access token with `write_repository` scope in `I18N_PUSH_TOKEN`.

**`.i18n-translate` variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `I18N_PROVIDER` | ✅ | — | `openai`, `anthropic`, or `google` |
| `I18N_MODEL` | ✅ | — | Model name |
| `I18N_API_KEY` | ✅ | — | API key for the provider |
| `I18N_LAYER` | — | all layers | Layer to translate. Leave empty to translate every locale-backed layer in one run — on a layered project `I18N_LOCALE_PATHS` must then cover every layer's directory, or those translations are written but never committed |
| `I18N_LOCALES` | — | all except source | Comma-separated target locales |
| `I18N_SOURCE_LOCALE` | — | from `.i18n-mcp.json` | Reference locale |
| `I18N_KEYS` | — | all missing | Comma-separated keys |
| `I18N_BATCH_SIZE` | — | `50` | Keys per LLM call |
| `I18N_DRY_RUN` | — | `false` | Preview without writing |
| `I18N_FAIL_ON_FAILED` | — | `false` | `"true"` adds `--fail-on-failed`, so the job exits `2` when any key failed to translate. Off by default: the run still commits what succeeded, and the failed keys stay missing for the next run to retry |
| `I18N_CLI_VERSION` | — | `latest` | Pin the-i18n-cli (npm version or dist-tag) |
| `I18N_INSTALL_PEER_DEPS` | — | — | Extra npm packages installed alongside the CLI |
| `I18N_PUSH_TOKEN` | — | — | Project access token (`write_repository`) — push alternative to the job token |
| `I18N_LOCALE_PATHS` | — | `i18n/locales/` | Space-separated globs for locale directories |
| `I18N_COMMIT_MESSAGE` | — | auto-generated | Custom commit message |

**`.i18n-cleanup` variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `I18N_LAYER` | — | all layers | Layer to scan. Leave empty to scan every layer |
| `I18N_FAIL_ON_ORPHANS` | — | `false` | `"true"` adds `--fail-on-orphans`, so the job exits `2` when orphans are found |
| `I18N_CLI_VERSION` | — | `latest` | Pin the-i18n-cli (npm version or dist-tag) |
| `I18N_INSTALL_PEER_DEPS` | — | — | Extra npm packages installed alongside the CLI |

**`.i18n-check` variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `I18N_CLI_VERSION` | — | `latest` | Pin the-i18n-cli (npm version or dist-tag) |
| `I18N_INSTALL_PEER_DEPS` | — | — | Extra npm packages installed alongside the CLI |

> **Enterprise setups** (private registries, yarn, custom images): override `before_script` on the extending job. The template's `image`, `before_script`, `tags`, and `cache` are all overridable.

---

## Supported Frameworks

| Framework | Locale Format | Auto-Detection | Locale Directories Probed |
|-----------|--------------|----------------|---------------------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` | `i18n/locales/` per app and per layer; honours each layer's `langDir` (default `locales`) |
| **Laravel** (9+) | PHP arrays or JSON | `artisan`, `composer.json`, `lang/` | `lang/` or `resources/lang/` — PHP subdirectories (`lang/en/*.php`) or flat JSON (`lang/en.json`) |
| **Vue** (SPA, v3) | JSON | `vue` in dependencies without Nuxt; `vue-i18n` raises confidence | `src/locales`, `locales`, `src/i18n/locales`, `i18n/locales`, `src/plugins/i18n/locales`, `src/i18n` — or a `localeDir`/`messages` path read out of `src/i18n/index.{ts,js}`, `src/plugins/i18n.{ts,js}`, `src/i18n.{ts,js}`, `i18n.{ts,js}` |
| **React / Next.js** | JSON | `next`, or `react` + `react-dom`, without Vue/Nuxt; `next-intl`, `next-translate`, `next-i18next`, `react-i18next` or `react-intl` raises confidence | `messages`, `public/locales`, `locales`, `src/i18n`, `src/locales`, `i18n` — namespaced (`messages/en/common.json`) or flat (`locales/en.json`). A `next.config.{ts,js,mjs}` using `createNextIntlPlugin` or `next-translate` pins the directory directly |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` | Exactly the paths listed in `localeDirs` |

Detection is confidence-scored, not order-based: the highest-scoring adapter wins. A `.i18n-mcp.json` carrying both `localeDirs` and `defaultLocale` scores highest, so an explicit config always beats framework inference. Set `"framework": "vue"` (or any adapter name) in that file to force one adapter and skip scoring entirely.

The Vue and React/Next adapters resolve a single locale directory and take the alphabetically first discovered locale as the default. If that is not your reference locale, pin it with `localeDirs` + `defaultLocale` so the generic adapter takes over.

## Using with Any Framework (Generic Adapter)

For projects that aren't covered by a framework adapter, create a `.i18n-mcp.json` at your project root:

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

> **Nuxt:** install [`@the-i18n-kit/nuxt`](./packages/nuxt) and the derived half of this
> file goes away. The module publishes the locale table and layer graph Nuxt already
> resolved, so `locales`, `localeDirs` and `defaultLocale` stop being restated by hand —
> and `protectedLocales` entries that match nothing, or match several locales, fail the
> build instead of failing quietly.

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

This context is automatically loaded on `discover` before any translation work, so agents use the right terminology and tone across all locales.

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
| `protectedLocales` | Human-maintained locales excluded from automatic translation |
| `localeDirs` | Locale directories for the generic adapter |
| `defaultLocale` | Default locale code (required for generic adapter) |
| `locales` | Explicit list of locale codes |
| `localeFileFormat` | Override the auto-detected locale file format (`"json"` or `"php-array"`) |
| `providerBaseUrl` | Provider base URL for protocol-compatible gateways, self-hosted models and proxies — see [Custom provider endpoints](#custom-provider-endpoints) |

`samplingPreferences` is deprecated and ignored (MCP sampling was removed). It is still accepted so existing config files keep validating — configure a provider instead (see [Translation Modes](#translation-modes)).

</details>

---

## Agent Translation Workflow

When an AI agent builds a feature and adds new translation keys:

1. **Agent adds `$t('some.key')`** to the Vue/Blade component
2. **Agent calls `discover`** → loads project setup and `.i18n-mcp.json` (context, glossary, layerRules) into its session
3. **Agent calls `write_translations`** — writes exact translations the agent provides. No LLM involved.
4. **Agent calls `translate_missing`** → fills any locales the agent didn't cover. In provider mode the server translates and writes directly; in agent mode it returns fallback contexts the agent translates inline and persists via `write_translations`.
5. **When source wording changes**, agent calls `translate_key` to refresh one key across target locales (including existing stale translations when `overwrite=true`).

The `add-feature-translations` MCP prompt codifies this as a reusable workflow. It also checks for duplicate keys via `search_translations` before writing.

> **Exact writes vs translation tools:** `write_translations` is a pure write tool — it takes locale-value maps and writes them, no LLM involved. `translate_missing` fills only missing target values. `translate_key` translates one source key into target locales and can overwrite stale existing target values.

---

## Handling Large Outputs

Tools like `find_orphan_keys` and `get_missing_translations` can return large payloads. Pass `--output-file` (CLI) or `outputFile` (MCP) to write the full report to disk and get only a compact summary back. Relative paths resolve against the project dir; the path must stay within it:

```bash
the-i18n-cli remove-orphans --output-file reports/orphans.json
# → Wrote report to: <project-dir>/reports/orphans.json
# → { orphanCount: 1103, filesScanned: 2526, ... }
```

```json
// MCP call
{ "tool": "find_orphan_keys", "arguments": { "outputFile": "reports/orphans.json" } }
// → { "reportFile": "<project-dir>/reports/orphans.json", "summary": { ... } }
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
