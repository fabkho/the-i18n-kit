# MCP server for managing i18n translations in Laravel

Built an MCP server that gives your AI agent full control over your Laravel translation files without it ever touching locale files directly.

## The problem

If you use an AI agent for translation work in Laravel, you know the drill — the agent opens your locale files to understand what's there, and suddenly your context is full of PHP arrays. With 20+ locales and thousands of keys that adds up fast and the agent starts losing track of what it was doing.

## What this does

`the-i18n-mcp` sits between your agent and your locale files. The agent calls tools like "get missing translations for French" or "add this key across all locales" and the server handles the file I/O. Only the relevant keys go through the context, not entire files.

It auto-detects Laravel projects (checks for `artisan`, `composer.json`, `lang/` directory) and reads your `config/app.php` for locale and fallback settings. No config needed to get started.

## PHP locale file handling

The server reads and writes PHP array locale files natively (the `lang/en/auth.php` style — JSON locale files aren't supported yet):

- Understands the namespace-per-file structure (`auth.php`, `validation.php`, etc.)
- Reads namespace files merged, writes them back split by top-level key
- Preserves your existing quoting style and indentation
- Writes are atomic (temp file + rename), keys stay alphabetically sorted

## Project-aware translations

This is probably the most useful part for day-to-day work. You can drop a `.i18n-mcp.json` at your project root and define:

- **Glossary** — term dictionary so "Booking" never becomes "Reservation" and "Resource" always stays "Resource"
- **Translation prompt** — your tone and style rules: "professional but approachable", "preserve all :placeholders exactly"
- **Per-locale notes** — "informal German (du)", "Dutch: Resource = 'Resource' (never 'Middel')", "French: use inclusive writing"

The server feeds all of this into every translation request. Instead of the LLM guessing your terminology, it follows your rules consistently across all locales.

```json
{
  "$schema": "node_modules/the-i18n-mcp/schema.json",
  "context": "B2B SaaS booking platform",
  "glossary": {
    "Buchung": "Booking (never 'Reservation')",
    "Ressource": "Resource (a bookable entity)"
  },
  "translationPrompt": "Professional but approachable tone. Preserve all :placeholders exactly.",
  "localeNotes": {
    "de": "Informal German (du).",
    "nl": "Dutch (je/jij). Resource = 'Resource' (never 'Middel')."
  }
}
```

## Code scanning and orphan detection

Scans your Blade templates and PHP files for translation key usage:

- `__()`, `trans()`, `trans_choice()`, `Lang::get()`, `@lang()` — all covered
- Dynamic keys like `__('prefix.' . $var)` detected correctly
- `vendor/`, `storage/`, `bootstrap/cache/` excluded

Find keys in your locale files that aren't used anywhere in your code and clean them up in one step.

## What else it can do

- Auto-detect project structure, locales, config
- Add, update, remove, rename keys across all locale files at once
- Find missing and empty translations
- Auto-translate missing keys via MCP sampling
- Scaffold locale files for new languages
- Search by key pattern or value

VS Code recommended — most complete MCP sampling support and lets you pick which model handles translations.

## Setup

No install needed:

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

Also works with Cursor, Zed, Claude Desktop.

GitHub: https://github.com/fabkho/the-i18n-mcp
npm: https://www.npmjs.com/package/the-i18n-mcp

Let me know what's missing or what would be useful.
