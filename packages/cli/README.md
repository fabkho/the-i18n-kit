# the-i18n-cli

[![npm version](https://img.shields.io/npm/v/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://npmjs.com/package/the-i18n-cli)
[![License](https://img.shields.io/npm/l/the-i18n-cli?style=flat&colorA=18181b&colorB=4fc08d)](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)

CLI and core library for managing i18n translation files — supports Nuxt, Laravel, and any project with JSON or PHP locale files.

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
the-i18n-cli detect                          # Auto-detect project config
the-i18n-cli missing                         # Find missing translations
the-i18n-cli search --query "save"           # Search keys and values
the-i18n-cli add --layer root --translations '{"common.btn.ok": {"en": "OK", "de": "OK"}}'
the-i18n-cli cleanup                         # Find orphan keys (dry-run by default)
```

## Commands

| Command | Description |
|---------|-------------|
| `detect` | Auto-detect i18n configuration |
| `list-dirs` | List locale directories by layer |
| `get` | Read translation values |
| `add` | Add new translation keys |
| `update` | Update existing keys |
| `missing` | Find keys missing in target locales |
| `empty` | Find keys with empty values |
| `search` | Search keys and values |
| `remove` | Remove keys from all locales |
| `rename` | Rename/move a key |
| `translate` | Get translation contexts for missing keys |
| `orphans` | Find keys not referenced in source code |
| `scan` | Find where keys are used in code |
| `cleanup` | Remove unused keys (dry-run by default) |
| `scaffold` | Create empty locale files for new languages |

Run `the-i18n-cli <command> --help` for per-command options.

### Common Flags

| Flag | Description |
|------|-------------|
| `-d, --projectDir <dir>` | Project directory (default: cwd) |
| `--json` | Output as JSON (default when piped) |
| `--dryRun` | Preview changes without writing |

## Supported Frameworks

| Framework | Locale Format | Auto-Detection |
|-----------|--------------|----------------|
| **Nuxt** (v3+) | JSON | `nuxt.config.ts` with `@nuxtjs/i18n` |
| **Laravel** (9+) | PHP arrays | `artisan`, `composer.json`, `lang/` |
| **Generic** | JSON or PHP | `localeDirs` + `defaultLocale` in `.i18n-mcp.json` |

For projects that aren't Nuxt or Laravel, add a `.i18n-mcp.json`:

```json
{
  "defaultLocale": "en",
  "localeDirs": ["src/locales"]
}
```

## Programmatic API

The CLI also exports all operations as a library for use in other tools:

```ts
import { detectConfig, getMissingTranslations, addTranslations } from 'the-i18n-cli'

const config = await detectConfig('/path/to/project')
const missing = await getMissingTranslations({ projectDir: '/path/to/project' })
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
  }
}
```

See the [full config reference](https://github.com/fabkho/the-i18n-kit#project-config) for all options.

## License

[MIT](https://github.com/fabkho/the-i18n-kit/blob/main/LICENSE)
