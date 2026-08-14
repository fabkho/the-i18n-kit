# @the-i18n-kit/nuxt

Nuxt module for [the i18n kit](https://github.com/fabkho/the-i18n-kit).

Nuxt already resolves your layer graph and your locale table. Without this module,
`.i18n-mcp.json` restates both by hand and the CLI re-derives them from outside by
loading `nuxt.config.ts` — two descriptions of the same thing, with nothing that
notices when they disagree.

This module publishes what Nuxt resolved, as a build artifact the CLI reads in
preference to hand-written config. The derived half of your config stops being
written twice.

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

Then remove `locales`, `localeDirs` and `defaultLocale` from `.i18n-mcp.json` —
the module derives them, and declaring them in both places is now an error rather
than a silent override.

In a monorepo with several Nuxt apps, install it in each app. Every app publishes
its own artifact and the CLI merges them, exactly as it merges apps today.

## What it does

On `nuxt prepare`, `nuxt dev` and `nuxt build`, it writes `.nuxt/i18n-kit.json`
describing this app: its locale table, its layers, and which of those layers carry
translations. `.nuxt` is already gitignored and already wiped by `nuxt cleanup`, so
the artifact is never a review artifact and cannot be merged.

It also checks, at build time, two things that used to fail silently:

- **`protectedLocales` entries that resolve to nothing.** `de-DE-formal` matches no
  locale when the code is `de-formal`, so it protected nothing while looking like it
  did. That is now a build error naming the valid codes.
- **`protectedLocales` entries that resolve to several locales.** `de-DE` is ambiguous
  when both `de` and `de-formal` declare it. Reported with all candidates.

A ref that resolves by language tag or file name rather than by code is a warning:
it works today, but a locale added later with the same tag would make it ambiguous
without anyone touching the line that wrote it.

## Configuring the kit from `nuxt.config.ts`

Everything Nuxt *cannot* derive — your glossary, tone notes, protected locales —
can be declared under `i18nKit`, typed and autocompleted, next to the i18n config
it talks about:

```ts
export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n', '@the-i18n-kit/nuxt'],

  i18nKit: {
    context: 'A B2B booking platform.',
    glossary: { anny: 'Brand name. NEVER translate.' },
    localeNotes: { 'de-formal': 'Formal German (Sie).' },
    protectedLocales: ['de-formal'],
  },
})
```

The module publishes it in the artifact and the CLI reads it, so `.i18n-mcp.json`
becomes optional for Nuxt projects. Declaring the same key in both places is an
error rather than a merge — silent precedence between two sources is the drift
this module exists to end.

Accepted keys: `context`, `glossary`, `translationPrompt`, `localeNotes`,
`examples`, `layerRules`, `protectedLocales`, `orphanScan`, `reportOutput`,
`localeFileFormat`, `providerBaseUrl`.

> **Why not under `i18n`?** `@nuxtjs/i18n` types that key through a type alias
> rather than an interface, so no other module can add to it —
> [nuxt-modules/i18n#4138](https://github.com/nuxt-modules/i18n/issues/4138).
> Unknown keys survive at runtime, but they do not type-check. If that is ever
> fixed, reading them from `i18n` too is additive.

### One thing to know about `protectedLocales`

The CLI reads policy from the generated artifact, so policy declared **only** in
`nuxt.config.ts` does not apply until something has built. For most keys that
costs a little context. For `protectedLocales` and `orphanScan` — the ones that
*suppress* work — it means an unbuilt checkout would translate locales you marked
protected. The module warns when you declare either there and nowhere else.

If that matters for your pipeline, keep those two in `.i18n-mcp.json`, which the
CLI reads directly with no build required.

## Module options

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Set to `false` to skip generation. The CLI falls back to adapter detection, exactly as without the module. |
| `failOnInvalidConfig` | `true` | Set to `false` to report configuration problems without failing the build. |

The artifact path is fixed at `<app>/.nuxt/i18n-kit.json`. The CLI looks there without
loading your Nuxt config — that is the point — so it cannot follow a renamed file or a
custom `buildDir`. With a custom `buildDir` the CLI simply falls back to loading the app,
as it does without this module.

## Removing it is safe

The CLI prefers the artifact when it is present, parseable, of a version it knows,
and not older than any `nuxt.config` it describes — the app's or any layer's. Any other case falls back to
loading the app through Nuxt — which is what it does today, for every project.

So adding this module changes nothing except where the facts come from, and removing
it degrades rather than breaks.

## Development

`playground/nuxt` in this repo is the dev target.

```bash
pnpm --filter @the-i18n-kit/nuxt build   # or `dev` for the stub build
pnpm --filter playground exec nuxt prepare
cat playground/nuxt/.nuxt/i18n-kit.json
```

## License

MIT
