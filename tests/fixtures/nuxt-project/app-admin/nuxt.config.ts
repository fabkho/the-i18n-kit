// App-admin layer — extends the root playground
export default defineNuxtConfig({
  extends: ['../'],

  modules: ['@nuxtjs/i18n'],

  i18n: {
    locales: [
      { code: 'de', language: 'de-DE', file: 'de-DE.json', name: 'Deutsch' },
      { code: 'en', language: 'en-US', file: 'en-US.json', name: 'English' },
      { code: 'fr', language: 'fr-FR', file: 'fr-FR.json', name: 'Français' },
      { code: 'es', language: 'es-ES', file: 'es-ES.json', name: 'Español' },
    ],
  },
})
