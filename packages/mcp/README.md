# @the-i18n-kit/mcp

[![npm version](https://img.shields.io/npm/v/@the-i18n-kit/mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@the-i18n-kit/mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/@the-i18n-kit/mcp)
[![License](https://img.shields.io/npm/l/the-i18n-mcp?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

MCP server for managing i18n translation files. Gives your agent 17 purpose-built
tools so it can touch the keys it needs without reading whole locale files into
context.

Built on [`@the-i18n-kit/cli`](https://www.npmjs.com/package/@the-i18n-kit/cli),
so a tool and its command produce the same result. Part of
[the-i18n-kit](https://github.com/fabkho/the-i18n-kit).

### 📖 [Documentation](https://fabkho.github.io/the-i18n-kit/)

## Quick Start

No install needed — your MCP host runs the server with `npx`.

**Cursor** — `.cursor/mcp.json`:

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

**VS Code** — `.vscode/mcp.json`, which uses a different key:

```json
{
  "servers": {
    "the-i18n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["@the-i18n-kit/mcp@latest"]
    }
  }
}
```

→ [Zed, Claude Desktop and the rest](https://fabkho.github.io/the-i18n-kit/getting-started/agent-setup)

## Documentation

| | |
|---|---|
| [Set up the server](https://fabkho.github.io/the-i18n-kit/getting-started/agent-setup) | Every host, and how to check it is working |
| [Tools](https://fabkho.github.io/the-i18n-kit/reference/mcp) | Generated from the listing a host receives |
| [Built for agents](https://fabkho.github.io/the-i18n-kit/introduction/built-for-agents) | Context discipline, classified failures, safe defaults |
| [Configuration](https://fabkho.github.io/the-i18n-kit/configuration/where-config-lives) | Glossary, tone, protected locales — [every field](https://fabkho.github.io/the-i18n-kit/configuration/reference) |
| [Monorepos and layers](https://fabkho.github.io/the-i18n-kit/monorepos/layers) | What the agent needs to know before deleting a key |

Translation modes — what happens with and without a provider configured — are
documented in the [CLI readme](https://github.com/fabkho/the-i18n-kit/tree/main/packages/cli#translation-modes)
until [#358](https://github.com/fabkho/the-i18n-kit/issues/358) moves them to the site.

## Migrating

`the-i18n-mcp` was renamed to `@the-i18n-kit/mcp`. The old name still publishes
during the deprecation window and the binary is unchanged; see
[#344](https://github.com/fabkho/the-i18n-kit/issues/344).

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
