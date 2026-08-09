# Reddit Posts — the-i18n-kit

---

## r/Nuxt

**Title:** Built an MCP server that stops Cursor from reading your entire Nuxt locale JSONs

Last week I asked Cursor to add one translation key to a Nuxt project. It opened all 14 locale JSON files. 9,400 lines. Context window torched before it wrote `$t()`.

So I built an MCP server that intercepts those reads. The agent calls a tool, gets back exactly the key it needs. Auto-detects your Nuxt config — layers, `langDir`, locales. Zero setup.

```bash
# CLI (no agent needed)
npm install -g the-i18n-cli
the-i18n-cli orphans --output-file /tmp/orphans.json  # summary, not the files

# MCP — one block
{ "servers": { "the-i18n-mcp": { "type": "stdio", "command": "npx", "args": ["the-i18n-mcp@latest"] } } }
```

Also: [GitHub Action](https://github.com/fabkho/the-i18n-kit/blob/main/action.yml) and [GitLab CI](https://github.com/fabkho/the-i18n-kit/blob/main/gitlab-ci.yml) for scheduled auto-translation, auto-PR/MR.

https://github.com/fabkho/the-i18n-kit

---

## r/Vuejs

**Title:** Cursor kept loading all my vue-i18n JSONs into context, so I built an MCP server

One key. That's all the agent needed. It opened all 20 locale files. 12,000 lines of JSON straight into context before writing a single line of Vue.

Built an MCP server that replaces raw file reads with tool calls. Agent asks for `booking.confirm.title`, gets `{ "en": "Confirm" }` back. Nothing more. Works with Nuxt (auto-detected) or any Vue project via a two-line config. CLI for the terminal too.

```bash
# CLI
npm install -g the-i18n-cli
the-i18n-cli orphans  # returns summary, not the files

# MCP — Cursor, VS Code, Claude
{ "servers": { "the-i18n-mcp": { "type": "stdio", "command": "npx", "args": ["the-i18n-mcp@latest"] } } }
```

CI templates included: [GitHub Action](https://github.com/fabkho/the-i18n-kit/blob/main/action.yml) + [GitLab CI](https://github.com/fabkho/the-i18n-kit/blob/main/gitlab-ci.yml) for scheduled auto-translation with auto-PR/MR.

https://github.com/fabkho/the-i18n-kit

---

## r/Laravel

**Title:** Built an MCP server so Claude stops reading my entire `lang/` directory

Asked Claude to add a translation to a Laravel project. It opened `en/auth.php`, `en/validation.php`, `de/auth.php`, `fr/auth.php` — every PHP array, every nested key. Context gone before it wrote `__('key')`.

Built an MCP server with a PHP array reader/writer. Finds Laravel projects automatically via `artisan` and `composer.json`. Agent asks for one key, gets one value back. Orphan scanner catches `__()`, `trans()`, `@lang` in Blade/PHP — returns a compact summary, never the raw files.

```bash
# CLI
npm install -g the-i18n-cli
the-i18n-cli detect  # confirms Laravel auto-detection
the-i18n-cli orphans --output-file /tmp/orphans.json  # summary, no PHP dump
```

MCP config is one block. [GitHub Action](https://github.com/fabkho/the-i18n-kit/blob/main/action.yml) and [GitLab CI](https://github.com/fabkho/the-i18n-kit/blob/main/gitlab-ci.yml) for scheduled auto-translation.

https://github.com/fabkho/the-i18n-kit

---

## r/Reactjs

**Title:** My AI agent kept loading all my react-i18next JSONs into context — so I fixed it

Every time I ask Cursor to touch a translation, it reads every locale JSON file in `src/locales/`. Thousands of lines. Eats half the context window before writing a single `t()` call.

Built an MCP server that sits between the agent and the files. Agent calls `get_translations` for one key — gets one value. Generic adapter works with any JSON-based i18n: drop a config pointing at your `localeDirs`. CLI for when you're not using an agent.

```bash
# .i18n-mcp.json
{ "defaultLocale": "en", "localeDirs": ["src/locales"] }

# CLI
npm install -g the-i18n-cli
the-i18n-cli missing
```

[GitHub Action](https://github.com/fabkho/the-i18n-kit/blob/main/action.yml) and [GitLab CI template](https://github.com/fabkho/the-i18n-kit/blob/main/gitlab-ci.yml) — schedule it, get auto-translated PRs/MRs. Open source (MIT).

https://github.com/fabkho/the-i18n-kit

---

## r/Nextjs

**Title:** Cursor kept loading all my next-intl messages into context, so I built a fix

`messages/en.json`, `messages/de.json`, `messages/fr.json` — agent needs one key, opens all of them. Context: gone.

Built an MCP server that replaces raw file access with tool calls. Points at your `messages/` dir via a tiny config file. Agent gets one key, not 15 files. Orphan scanner finds dead keys across your source tree, returns a summary instead of dumping JSON. CLI for the terminal, CI templates for GitHub/GitLab — scheduled auto-translation with auto-PRs.

```bash
# .i18n-mcp.json
{ "defaultLocale": "en", "localeDirs": ["messages"] }

# CLI
npm install -g the-i18n-cli
the-i18n-cli missing
```

[GitHub Action](https://github.com/fabkho/the-i18n-kit/blob/main/action.yml) + [GitLab CI](https://github.com/fabkho/the-i18n-kit/blob/main/gitlab-ci.yml). MIT license.

https://github.com/fabkho/the-i18n-kit
