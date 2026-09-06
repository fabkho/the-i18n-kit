# Vue playground

A Vue 3 SPA using **vue-i18n**, resolved by the generic adapter.

```bash
the-i18n-cli status --projectDir playground/vue
```

## What it is here to prove

**Locale files probing would never find.** They live in `src/translations`, which is not one of the conventional directories (`locales`, `src/locales`, `i18n/locales`, `src/i18n/locales`, `src/i18n`). One line in `i18n-kit.config.ts` names it:

```ts
localeDirs: ['src/translations']
```

**Policy no Vue config can express.** The same file declares `defaultLocale: 'en-US'`, so the reference locale is English rather than `de-DE`, which is merely what the alphabet suggests. It marks `de-DE` as human-maintained so nothing machine-translates into it, and carries the glossary and tone notes. Being TypeScript, a misspelled key is an editor error rather than a line that quietly does nothing:

```
$ the-i18n-cli status --projectDir playground/vue --json | jq .summary.protectedLocales
["de-DE"]
```

**`.vue` files are scanned.** `src/App.vue` calls both `$t('…')` in the template and `t('…')` from `useI18n()`, and `orphans` sees both.

## No install required

There is no `node_modules` here — this is a fixture, not a workspace member, so it costs CI nothing. `@the-i18n-kit/cli/config` resolves to the running CLI, so the config file is read as it is.

## Deliberately incomplete

The `booking` namespace is missing entirely from `es-ES` and partly from `fr-FR`, so `missing` and `status` have something to report.
