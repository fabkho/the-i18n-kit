# Generic playground

A project with **no i18n framework at all** — plain JSON files loaded by hand — for exercising the generic adapter.

```bash
the-i18n-cli status --projectDir playground/generic
```

## What it is here to prove

There is nothing to detect and nothing to read: no `nuxt.config`, no `vite.config`, no `next.config`, not even a `package.json` dependency worth scoring. Everything the CLI knows comes from `i18n-kit.config.ts`:

```ts
export default defineI18nKitConfig({
  localeDirs: ['translations'],
  defaultLocale: 'en',
})
```

`localeDirs` and `defaultLocale` together are what activate the generic adapter, and what let it outscore framework inference. Locale files live in `translations/`, which no adapter probes.

This is the case the typed config matters most for, because it is the only source of truth there is. Previously it had to be untyped JSON — a misspelled `localeDirs` meant the adapter silently did not activate, and the CLI reported that it could not work out what kind of project this was.

## Deliberately incomplete

`booking` is absent from `nl` and partial in `fr`, and `app.tagline` is missing from `nl`, so `missing` and `status` have something to report.
