# @the-i18n-kit/cli

[![npm version](https://img.shields.io/npm/v/@the-i18n-kit/cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/cli)
[![License](https://img.shields.io/npm/l/@the-i18n-kit/cli?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

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
| [Agent contract](https://fabkho.github.io/the-i18n-kit/getting-started/agent-contract) | Exit codes, gates, failure reasons, output diversion, env vars |
| [Configuration](https://fabkho.github.io/the-i18n-kit/configuration/where-config-lives) | Where it lives, precedence, [every field](https://fabkho.github.io/the-i18n-kit/configuration/reference) |
| [Frameworks](https://fabkho.github.io/the-i18n-kit/frameworks/detection) | What each adapter reads, and how to pin one |
| [Monorepos and layers](https://fabkho.github.io/the-i18n-kit/monorepos/layers-and-consumer-graph) | Why usage in one app does not protect a key in another |
| [Orphan detection](https://fabkho.github.io/the-i18n-kit/monorepos/orphan-detection) | What the scanner sees, its blind spots, and the call-site style that keeps a report specific |
| [Translation modes](https://fabkho.github.io/the-i18n-kit/concepts/translation-modes) | Provider and agent mode, and what is validated before writing |
| [CI/CD](https://fabkho.github.io/the-i18n-kit/ci-cd/github-actions) | The Action and the GitLab template |

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
