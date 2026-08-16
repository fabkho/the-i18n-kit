# React / Next.js playground

A Next.js App Router project using **next-intl**, for exercising the React adapter.

```bash
the-i18n-cli status --projectDir playground/react
```

## What it is here to prove

`messages/` contains `de-DE`, `en-US`, `es-ES` and `fr-FR`. Alphabetically first is `de-DE` — and until the adapter could read a project's own config, that made German the reference locale of an English project purely by sorting order ([#296](https://github.com/fabkho/the-i18n-kit/issues/296)).

`src/i18n/routing.ts` says otherwise, and is read:

```ts
export const routing = defineRouting({
  locales: ['de-DE', 'en-US', 'es-ES', 'fr-FR'],
  defaultLocale: 'en-US',
})
```

So `status` reports `en-US` as the reference locale. Change `defaultLocale` there and the CLI follows it, with no `.i18n-mcp.json` involved.

`next.config.mjs` is a realistic one — wrapped in `withNextIntl(...)`, so it cannot be executed without the dependencies installed. It is never reached: the routing file is more specifically about i18n and is read first. If you delete `src/i18n/routing.ts`, the CLI warns that it could not read `next.config.mjs` and falls back to directory order, which is the intended never-load-bearing behaviour rather than a failure.

## No install required

There is no `node_modules` here, deliberately — this is a fixture, not a workspace member, so it costs CI nothing. `defineRouting` returns its argument unchanged, so when next-intl cannot be resolved the CLI substitutes an identity stub and reads the file anyway. Run `pnpm add next-intl` inside this directory and the real package is preferred; the answer is identical either way.

## Deliberately incomplete

`booking.slotsLeft` exists only in `en-US` and `de-DE`, and the whole `booking` namespace is missing from `es-ES`, so `missing` and `status` have something to report.
