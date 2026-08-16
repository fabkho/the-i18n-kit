export default defineNuxtConfig({
  extends: ['docus'],

  // Deployed to GitHub Pages at a repository subpath. Moving to a custom
  // domain later means deleting baseURL; the reverse means auditing every
  // internal link, so the subpath is the safer default to start from.
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/the-i18n-kit/',
  },

  // Static output. The preset writes the Jekyll opt-out for us.
  nitro: {
    preset: 'github-pages',
  },

  // The agent configuration under docs/agents/ is not site content.
  content: {
    build: {
      markdown: {
        toc: { depth: 3, searchDepth: 3 },
      },
    },
  },

  compatibilityDate: '2026-08-16',
})
