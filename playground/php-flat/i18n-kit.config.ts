import { defineI18nKitConfig } from 'the-i18n-cli/config'

/**
 * A PHP project that is not Laravel: one flat file per locale rather than
 * lang/<locale>/<namespace>.php. Nothing here can be detected, so `localeDirs`
 * plus `defaultLocale` declares it and activates the generic adapter.
 */
export default defineI18nKitConfig({
  localeDirs: ['lang'],
  defaultLocale: 'en',
  context: 'A booking backend in plain PHP — no framework, flat array locale files.',
  glossary: {
    Booking: "Core concept. Never 'Reservation'.",
  },
  translationPrompt: 'Professional but approachable. Preserve all :placeholders. Keep translations concise.',
  localeNotes: {
    de: 'Informal German (du).',
    fr: 'French.',
  },
})
