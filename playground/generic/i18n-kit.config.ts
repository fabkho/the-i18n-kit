import { defineI18nKitConfig } from '@the-i18n-kit/cli/config'

/**
 * There is no framework here to ask, so everything is declared. `localeDirs`
 * plus `defaultLocale` is what activates the generic adapter — and what makes
 * it win detection over any framework the dependencies might otherwise hint at.
 */
export default defineI18nKitConfig({
  localeDirs: ['translations'],
  defaultLocale: 'en',
  context: 'A SaaS booking platform with no i18n framework — plain JSON files read at runtime.',
  glossary: {
    Booking: "Core concept. Never 'Reservation'.",
    Resource: 'A bookable entity — a room, a desk, a person.',
  },
  translationPrompt: 'Professional but approachable. Preserve all {placeholders}. Keep translations concise.',
  localeNotes: {
    de: 'Informal German (du).',
    fr: 'French.',
    nl: 'Dutch.',
  },
})
