# the-i18n-kit

[![CI](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fabkho/the-i18n-kit/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
[![Glama score](https://glama.ai/mcp/servers/fabkho/the-i18n-kit/badges/score.svg)](https://glama.ai/mcp/servers/fabkho/the-i18n-kit)

**The i18n toolkit for AI agents and large monorepos.** Find missing keys, remove
dead ones, and rename across every locale and layer at once — from your agent,
your terminal, or your pipeline.

### 📖 [Documentation](https://fabkho.github.io/the-i18n-kit/)

---

## Packages

| Package | Version | What it is |
|---------|---------|------------|
| [**@the-i18n-kit/cli**](./packages/cli) | [![npm](https://img.shields.io/npm/v/@the-i18n-kit/cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/cli) | The CLI, and the library every other surface is built on |
| [**@the-i18n-kit/mcp**](./packages/mcp) | [![npm](https://img.shields.io/npm/v/@the-i18n-kit/mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/mcp) | MCP server, for AI coding agents |
| [**@the-i18n-kit/nuxt**](./packages/nuxt) | [![npm](https://img.shields.io/npm/v/@the-i18n-kit/nuxt?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/nuxt) | Publishes the layer graph Nuxt already resolved |

A GitHub Action and a GitLab CI template ship from this repository too.

## Quick Start

```bash
npm install -g @the-i18n-kit/cli

the-i18n-cli init        # write a config from what it detects
the-i18n-cli status      # coverage per locale and per layer
the-i18n-cli missing     # what is not translated yet
```

For an AI agent, point your MCP host at the server:

```json
{
  "mcpServers": {
    "the-i18n-mcp": {
      "command": "npx",
      "args": ["@the-i18n-kit/mcp@latest"]
    }
  }
}
```

→ [Getting started](https://fabkho.github.io/the-i18n-kit/getting-started/cold-start) ·
[MCP setup](https://fabkho.github.io/the-i18n-kit/getting-started/agent-setup) ·
[CLI reference](https://fabkho.github.io/the-i18n-kit/reference/cli)

## Documentation

Everything lives on the [documentation site](https://fabkho.github.io/the-i18n-kit/).
The reference sections are generated from the source they describe, so they
cannot drift from it.

| | |
|---|---|
| [Why this toolkit](https://fabkho.github.io/the-i18n-kit/introduction/why) | Who it is for, and who it is not |
| [Monorepos and layers](https://fabkho.github.io/the-i18n-kit/monorepos/layers) | The consumer graph, shared libraries, misplaced usages |
| [Frameworks](https://fabkho.github.io/the-i18n-kit/frameworks/detection) | Nuxt, Laravel, Vue, React/Next, generic |
| [Configuration](https://fabkho.github.io/the-i18n-kit/configuration/where-config-lives) | Where it lives, precedence, every field |
| [CI/CD](https://fabkho.github.io/the-i18n-kit/ci-cd/github-actions) | The Action and the GitLab template |
| [CLI](https://fabkho.github.io/the-i18n-kit/reference/cli) · [MCP tools](https://fabkho.github.io/the-i18n-kit/reference/mcp) | Generated reference |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

`DEBUG=1` enables verbose logging to stderr. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
