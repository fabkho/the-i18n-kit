import { defineI18nKitConfig } from '@the-i18n-kit/cli/config'

/**
 * Everything about this project the kit cannot see for itself: where the
 * locale files are, which locale is the source of truth, and how the product
 * wants to be translated.
 *
 * Typed, so a misspelled key is an editor error rather than a silently
 * ignored one.
 */
export default defineI18nKitConfig({
  // Not one of the conventional directories, so it is named here.
  localeDirs: ['src/translations'],
  defaultLocale: 'en-US',
  context: 'A SaaS booking platform. Vue 3 SPA with vue-i18n.',
  glossary: {
    Booking: "Core concept. Never 'Reservation'.",
    Resource: 'A bookable entity — a room, a desk, a person.',
  },
  translationPrompt: 'Professional but approachable. Preserve all {placeholders}. Keep translations concise.',
  localeNotes: {
    'de-DE': 'Informal German (du). Maintained by hand.',
    'fr-FR': 'French.',
    'es-ES': 'Spanish.',
  },
  // German is written by a person here, so nothing may machine-translate into
  // it. Address a protected locale by its `code`: a ref matching nothing is
  // the mistake this file being typed is meant to catch.
  protectedLocales: ['de-DE'],
})
