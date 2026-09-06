# @the-i18n-kit/nuxt

Nuxt module for [the i18n kit](https://github.com/fabkho/the-i18n-kit).

Nuxt already resolves your layer graph and your locale table. This module
publishes what Nuxt resolved as a build artifact the CLI reads in preference to
hand-written config, so the derived half of your configuration stops being
written twice.

### 📖 [Documentation](https://fabkho.github.io/the-i18n-kit/nuxt-module/install)

## Install

```bash
pnpm add -D @the-i18n-kit/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n', '@the-i18n-kit/nuxt'],
})
```

Then remove `locales`, `localeDirs` and `defaultLocale` from your kit config —
the module derives all three, and declaring them by hand now fails the build. In
a monorepo, register it in each Nuxt app.

## What It Does

On `nuxt prepare`, `nuxt dev` and `nuxt build` it writes `.nuxt/i18n-kit.json`
describing this app: its locale table, its layers, and which of those carry
translations. It also fails the build on a `protectedLocales` entry that resolves
to no locale or to several.

Kit policy — glossary, tone notes, protected locales, orphan-scan patterns —
lives in `i18n-kit.config.ts` or `.i18n-mcp.json`, not here, so it applies in a
checkout that has never built.

Removing the module is safe: the CLI falls back to loading the app through Nuxt,
which is what it does for every project without it.

→ [The artifact, the two module options, and every fallback case](https://fabkho.github.io/the-i18n-kit/nuxt-module/artifact-and-options)

## Development

`playground/nuxt` in this repo is the dev target.

```bash
pnpm --filter @the-i18n-kit/nuxt build
pnpm --filter playground exec nuxt prepare
cat playground/nuxt/.nuxt/i18n-kit.json
```

## License

MIT
