# @the-i18n-kit/eslint-plugin-vue

ESLint rules for [the i18n kit](https://github.com/fabkho/the-i18n-kit): two
authoring rules that keep the orphan scanner sound, and a layer-aware preset that
checks key existence per app against the layers it consumes. Lints `.vue`, `.ts`,
`.js`, `.mjs` (and `.tsx`/`.jsx` through `layerAware()`).

### 📖 [Documentation](https://fabkho.github.io/the-i18n-kit/eslint-plugin/install-and-rules)

## Install

```bash
pnpm add -D @the-i18n-kit/eslint-plugin-vue
```

```js
// eslint.config.mjs
import i18nKit, { layerAware } from '@the-i18n-kit/eslint-plugin-vue'

export default [
  ...i18nKit.configs.recommended,
  ...await layerAware(), // needs @intlify/eslint-plugin-vue-i18n and @the-i18n-kit/cli
]
```

With `@nuxt/eslint`, register the addon instead of spreading the blocks:

```ts
// nuxt.config.ts
import { i18nKitEslintAddon } from '@the-i18n-kit/eslint-plugin-vue/nuxt'

export default defineNuxtConfig({
  modules: ['@nuxt/eslint'],
  hooks: { 'eslint:config:addons': addons => addons.push(i18nKitEslintAddon()) },
})
```

## License

MIT
