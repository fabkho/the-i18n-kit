# Vue playground

A Vue 3 SPA using **vue-i18n** and `@intlify/unplugin-vue-i18n`, for exercising the Vue adapter.

```bash
the-i18n-cli status --projectDir playground/vue
```

## What it is here to prove

**Locale files that probing would never find.** They live in `src/translations`, which is not one of the six directories the adapter guesses at (`src/locales`, `locales`, `src/i18n/locales`, `i18n/locales`, `src/plugins/i18n/locales`, `src/i18n`). Before the adapter could read a build config, this project simply failed with "no locale directory found".

`vite.config.ts` says where they are, and that is read:

```ts
VueI18nPlugin({ include: [resolve(here, './src/translations/**')] })
```

The plugin keeps `include` in a closure — the object it returns is nothing but Vite hooks — so the CLI substitutes a stub that records the call. Nothing of the resolved Vite config is used beyond that one value.

**Policy no Vue config can express.** `i18n-kit.config.ts` declares `defaultLocale: 'en-US'`, so the reference locale is English rather than `de-DE`, which is merely what the alphabet suggests. It marks `de-DE` as human-maintained so nothing machine-translates into it, and carries the glossary and tone notes. Being TypeScript, a misspelled key is an editor error rather than a line that quietly does nothing:

```
$ the-i18n-cli status --projectDir playground/vue --json | jq .summary.protectedLocales
["de-DE"]
```

## No install required

There is no `node_modules` here — this is a fixture, not a workspace member, so it costs CI nothing. The plugin is substituted rather than imported, and `the-i18n-cli/config` resolves to the running CLI, so both files are read as they are.

## Deliberately incomplete

The `booking` namespace is missing entirely from `es-ES` and partly from `fr-FR`, so `missing` and `status` have something to report.
