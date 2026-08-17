// Deployed to GitHub Pages at a repository subpath. Moving to a custom domain
// later means setting this to '/'; the reverse means auditing every internal
// link, so the subpath is the safer default to start from.
const baseURL = process.env.NUXT_APP_BASE_URL || '/the-i18n-kit/'

// The prerender crawler starts at / and follows links. The landing page does
// not link into the sections, so without a seed per section it prerenders the
// landing page alone and every docs page is missing from the static output —
// the site builds green and ships three HTML files. One seed per section is
// enough: it renders inside the docs layout, whose sidebar links the rest, and
// crawlLinks follows from there. These can go once the home page links the
// sections. Seeds carry the base path, since they are not resolved through it.
const sectionSeeds = [
  'introduction/why',
  'monorepos/layers',
  'frameworks/detection',
  'configuration/where-config-lives',
].map(path => baseURL + path)

export default defineNuxtConfig({
  extends: ['docus'],

  app: {
    baseURL,
  },

  nitro: {
    preset: 'github-pages',

    prerender: {
      crawlLinks: true,
      routes: sectionSeeds,
      // A seed pointing at a page that no longer exists should fail the build
      // rather than quietly shrink the site back to a landing page.
      failOnError: true,
    },
  },

  // Docus enables @nuxtjs/mcp-toolkit by default, which mounts a live /mcp
  // endpoint. GitHub Pages serves files, not handlers, so that route could only
  // ever 404 in production. Turning the module off keeps it out of the bundle.
  // The Docus AI assistant needs no switch: it registers its server route only
  // when AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is set, and neither is here, so
  // it ships the disabled stub component instead. Static search is unaffected —
  // it runs client-side off the prerendered content index.
  mcp: {
    enabled: false,
  },

  // @nuxt/robots refuses to emit a robots.txt when the app is served from a
  // subpath, since the file is only honoured at a domain root. Nothing to
  // publish there until the site moves to its own domain.
  robots: {
    robotsTxt: false,
  },

  content: {
    build: {
      markdown: {
        toc: { depth: 3, searchDepth: 3 },
      },
    },
  },

  compatibilityDate: '2026-08-16',
})
