/**
 * Guards against the subtitle coming back.
 *
 * Docus renders a page's `description` under its heading. Every page had one
 * that restated the title, so they moved under `seo:` — where the text still
 * feeds the meta tag and the OG image but renders nothing.
 *
 * Removing the key outright is not enough, and that is the trap this test
 * exists for: Nuxt Content *derives* a description from the page's first
 * paragraph when the frontmatter omits one. Docus then renders that, so a page
 * opening with a paragraph shows its first line twice. Pages opening with a
 * heading are unaffected, which is what made it easy to miss.
 *
 * An explicit empty value stops the derivation.
 */

import { describe, expect, it } from 'vitest'
import { contentPages, frontmatterOf } from './pages.js'

describe('page frontmatter', () => {
  it('finds pages to check', () => {
    expect(contentPages().length).toBeGreaterThan(20)
  })

  it('declares description explicitly, so none is derived from the first paragraph', () => {
    for (const page of contentPages()) {
      const { name } = page
      const frontmatter = frontmatterOf(page)
      expect(frontmatter, `${name} has no frontmatter`).not.toBe('')
      expect(
        /^description:/m.test(frontmatter),
        `${name} omits description — Nuxt Content will derive one from its first paragraph and Docus will render it as a subtitle`,
      ).toBe(true)
    }
  })

  it('leaves that description empty, so no subtitle renders', () => {
    for (const page of contentPages()) {
      const { name } = page
      const frontmatter = frontmatterOf(page)
      const value = /^description:(.*)$/m.exec(frontmatter)?.[1]?.trim()
      expect(value, `${name} renders a subtitle: description is not empty`).toMatch(/^(''|"")$/)
    }
  })
})
