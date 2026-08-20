# @the-i18n-kit/cli

[![npm version](https://img.shields.io/npm/v/@the-i18n-kit/cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/cli)
[![License](https://img.shields.io/npm/l/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

Find missing translation keys, remove dead ones, and rename across every locale
and layer at once. Supports Nuxt, Laravel, Vue, React/Next.js, and any project
with JSON or PHP locale files.

Part of [the-i18n-kit](https://github.com/fabkho/the-i18n-kit).

### 📖 [Documentation](https://fabkho.github.io/the-i18n-kit/)

## Install

```bash
npm install -g @the-i18n-kit/cli
```

The binary is `the-i18n-cli`, whatever the package is called.

## Quick Start

```bash
the-i18n-cli init                    # write a config from what it detects
the-i18n-cli status                  # coverage per locale and per layer
the-i18n-cli missing                 # what is not translated yet
the-i18n-cli check                   # keys used in code but defined nowhere
the-i18n-cli remove-orphans          # keys defined but unused (previews by default)
```

→ [Cold start guide](https://fabkho.github.io/the-i18n-kit/getting-started/cold-start) ·
[every command and flag](https://fabkho.github.io/the-i18n-kit/reference/cli) ·
[the library API](https://fabkho.github.io/the-i18n-kit/reference/programmatic-api)

## Documentation

| | |
|---|---|
| [Commands](https://fabkho.github.io/the-i18n-kit/reference/cli) | Generated from the command definitions |
| [Configuration](https://fabkho.github.io/the-i18n-kit/configuration/where-config-lives) | Where it lives, precedence, [every field](https://fabkho.github.io/the-i18n-kit/configuration/reference) |
| [Frameworks](https://fabkho.github.io/the-i18n-kit/frameworks/detection) | How detection works, and what each adapter reads |
| [Monorepos and layers](https://fabkho.github.io/the-i18n-kit/monorepos/layers) | Why usage in one app does not protect a key in another |
| [Referring to locales](https://fabkho.github.io/the-i18n-kit/configuration/locale-refs) | Codes, language tags, and why the code is the one to use |
| [CI/CD](https://fabkho.github.io/the-i18n-kit/ci-cd/github-actions) | The Action and the GitLab template |

The two sections below have not moved to the site yet. They are the deepest
material here, and both are being rewritten against the new extraction
architecture — see [#358](https://github.com/fabkho/the-i18n-kit/issues/358).

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

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
