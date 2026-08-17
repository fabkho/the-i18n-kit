import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// Deployed to GitHub Pages at a repository subpath. Moving to a custom domain
// later means setting this to '/'; the reverse means auditing every internal
// link, so the subpath is the safer default to start from.
const baseURL = process.env.NUXT_APP_BASE_URL || '/the-i18n-kit/'

/**
 * Every content page, as a prerender route.
 *
 * The crawler starts at / and follows links. The landing page does not link
 * into the sections, so on its own it prerenders the landing page and nothing
 * else — the site builds green and ships three HTML files while every docs page
 * is absent from the deploy.
 *
 * Enumerating the content tree rather than listing seeds by hand matters for
 * more than tidiness: a hand-written list is a claim about which pages exist,
 * and it was wrong the moment the content lived on a different branch than the
 * config. Deriving it means any branch prerenders exactly its own pages.
 *
 * Mirrors Nuxt Content's path mapping: numeric ordering prefixes are stripped
 * from each segment, and index.md maps to its directory.
 */
function routeForPage(slug: string, prefix: string): string[] {
  if (!slug.endsWith('.md')) {
    return []
  }
  const name = slug.replace(/\.md$/, '')
  // index.md maps to its directory. At the root that is the landing page, which
  // the crawler reaches on its own.
  if (name === 'index') {
    return prefix ? [prefix] : []
  }
  return [`${prefix}/${name}`]
}

function contentRoutes(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const slug = entry.name.replace(/^\d+\./, '')
    return entry.isDirectory()
      ? contentRoutes(join(dir, entry.name), `${prefix}/${slug}`)
      : routeForPage(slug, prefix)
  })
}

const prerenderRoutes = contentRoutes(join(import.meta.dirname, 'content'))
  .map(route => baseURL.replace(/\/$/, '') + route)

export default defineNuxtConfig({
  extends: ['docus'],

  app: {
    baseURL,
  },

  nitro: {
    preset: 'github-pages',

    prerender: {
      crawlLinks: true,
      routes: prerenderRoutes,
      // A route that fails to render, or an internal link pointing at a page
      // that does not exist, should fail the build rather than quietly shrink
      // the site back to a landing page.
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
