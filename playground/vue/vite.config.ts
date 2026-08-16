import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `include` is the authoritative statement of where the locale files live —
 * and `src/translations` is deliberately not one of the directories the
 * adapter would otherwise probe.
 */
export default {
  plugins: [
    VueI18nPlugin({
      include: [resolve(here, './src/translations/**')],
    }),
  ],
}
