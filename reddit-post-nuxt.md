# the-i18n-mcp v2 — update on the i18n MCP server

A few weeks ago I posted about `nuxt-i18n-mcp`, an MCP server that lets your AI agent manage translation files without bloating context with locale JSONs. Lot of improvements since then.

## What's new

**Monorepo support.** If you have multiple Nuxt apps in a monorepo, the server discovers all of them automatically. Point it at the root and each app's locale directory becomes a separate layer.

**Add a new language in one prompt.** Tell the agent "add Swedish" and it scaffolds empty locale files, translates everything from your reference locale, and verifies zero gaps. The `add-language` prompt handles the full workflow.

**translate_missing got better.** It was working before but had rough edges — occasional timeouts, truncated responses on large batches, sometimes picking expensive models. Now the server sends model preferences hinting toward fast/cheap models, maxTokens scales with batch size, JSON parsing handles malformed responses, and failed batches retry automatically. We run it on 1,000+ keys across 13 locales in production and it's been smooth. You can also split locales across parallel calls for faster throughput.

**Project-aware translations.** You can drop a `.i18n-mcp.json` at your project root with a glossary, translation prompt, and per-locale notes. The server feeds all of this into every translation request so the LLM knows your terminology, tone, and locale-specific rules. Stuff like "never translate Booking as Reservation" or "use informal German (du)" — the agent follows it consistently across all locales.

VS Code recommended — most complete MCP sampling support, and you can restrict which model handles translations per-server.

Side note: the package was renamed to `the-i18n-mcp` (old name still works) and now also supports Laravel. The adapter architecture makes it easy to add more frameworks in the future.

## Setup

Same as before:

`.vscode/mcp.json`:
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

GitHub: https://github.com/fabkho/the-i18n-mcp
npm: https://www.npmjs.com/package/the-i18n-mcp

Happy to answer questions or hear what's missing.
