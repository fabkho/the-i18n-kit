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

| [Translation modes](https://fabkho.github.io/the-i18n-kit/concepts/translation-modes) | Provider and agent mode, the result contract, what is validated before writing |

The section below has not moved to the site yet. It is the deepest material
here, and it is being rewritten against the new extraction architecture — see
[#358](https://github.com/fabkho/the-i18n-kit/issues/358).


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
