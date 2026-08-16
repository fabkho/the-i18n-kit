import { defineRouting } from 'next-intl/routing'

/**
 * The authoritative statement of this project's locales. The CLI reads this
 * file rather than guessing from the contents of `messages/` — where the
 * alphabetically first entry is `de-DE`, which is not the default locale.
 */
export const routing = defineRouting({
  locales: ['de-DE', 'en-US', 'es-ES', 'fr-FR'],
  defaultLocale: 'en-US',
})
