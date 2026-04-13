export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxtjs/i18n'],

  i18n: {
    strategy: 'prefix_and_default',
    defaultLocale: 'de',
    locales: [
      { code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' },
      { code: 'en', language: 'en-US', file: 'en-US.json', name: 'English' },
      { code: 'fr', language: 'fr-FR', file: 'fr-FR.json', name: 'Français' },
      { code: 'es', language: 'es-ES', file: 'es-ES.json', name: 'Español' },
    ],
  },
})
