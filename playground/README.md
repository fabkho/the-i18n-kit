# Playgrounds

One project per supported adapter, so that every detection and resolution path has somewhere real to be run against.

| Directory | Adapter | Locale files | Reference locale comes from |
|---|---|---|---|
| [`nuxt`](./nuxt) | Nuxt | `i18n/locales/` per layer | `nuxt.config.ts`, via `@nuxtjs/i18n` |
| [`react`](./react) | React / Next.js | `messages/` | `src/i18n/routing.ts` — next-intl |
| [`vue`](./vue) | Vue | `src/translations/` | `i18n-kit.config.ts`; directories from `vite.config.ts` |
| [`laravel`](./laravel) | Laravel | `lang/<locale>/*.php` | directory layout |
| [`generic`](./generic) | Generic | `translations/` | `i18n-kit.config.ts` — the only source there is |

```bash
pnpm --filter the-i18n-cli build

for p in nuxt react vue laravel generic; do
  node packages/cli/dist/bin.js status --projectDir "playground/$p"
done
```

Each one has a README explaining what it exists to prove.

## Between them they cover every way the CLI can learn a project's locales

1. **Declared by a person** — `i18n-kit.config.ts` (`vue`, `generic`) or `.i18n-mcp.json` (`nuxt`, `laravel`).
2. **Published by a build** — `.nuxt/i18n-kit.json`, written by `@the-i18n-kit/nuxt` (`nuxt`).
3. **Read from the framework's own config** — next-intl's routing file (`react`), the unplugin's `include` (`vue`).
4. **Probed from directory layout** — the fallback, and all `laravel` needs.

Each also has locales that are deliberately incomplete, so `missing`, `status` and `translate` have something to report rather than a uniform green.

## Only `nuxt` is a workspace member

It needs a real install: its config loads `@the-i18n-kit/nuxt`, and the E2E translate workflow builds and runs it.

The rest are fixtures with no `node_modules`, which is why adding four of them costs CI nothing. They still contain the imports a real project would (`next-intl/routing`, `@intlify/unplugin-vue-i18n/vite`, `the-i18n-cli/config`), because the CLI substitutes what it cannot resolve — and prefers the real package wherever one is installed. Run `pnpm install` inside any of them and the output does not change.
