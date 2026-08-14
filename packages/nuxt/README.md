# @the-i18n-kit/nuxt

Nuxt module for [the i18n kit](https://github.com/fabkho/the-i18n-kit).

Nuxt already resolves your layer graph and your locale table. Today every consumer
restates both in `.i18n-mcp.json`, and the two descriptions drift. This module
publishes what Nuxt resolved as a build artifact the CLI reads in preference to
hand-written config, so the derived half of the config stops being written twice.

**Status: skeleton.** The package exists so the npm name, build tooling and release
wiring are settled; artifact generation lands with
[#305](https://github.com/fabkho/the-i18n-kit/issues/305).

## Install

```bash
pnpm add -D @the-i18n-kit/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@the-i18n-kit/nuxt'],
})
```

## Options

Configured under the `i18nKit` key.

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Set to `false` to skip artifact generation. The CLI then falls back to adapter detection, exactly as without the module. |
| `artifact` | `'i18n-kit.json'` | Artifact path, relative to the Nuxt build dir. |

## Development

`playground/nuxt` in this repo is the dev target.

```bash
pnpm --filter @the-i18n-kit/nuxt build   # or `dev` for the stub build
pnpm --filter playground dev
```

## License

MIT
