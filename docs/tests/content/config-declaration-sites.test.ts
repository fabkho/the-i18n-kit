/**
 * Guards the configuration pages against the drift that #380 was filed for.
 *
 * Policy used to be declarable in `nuxt.config.ts` as well as the two config
 * files. #372 removed that, and three hand-written pages plus the description
 * published in the JSON Schema went on describing it for days — the generated
 * field reference was the only part of the site that noticed, because it
 * derives the answer instead of asserting it.
 *
 * A prose claim about runtime behaviour has nothing enforcing it. This is the
 * narrow enforcement for the one claim that has already gone stale once: if the
 * Nuxt module ever carries policy options again, these tests fail and the pages
 * are meant to be rewritten. If it does not, no page may say it does.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleOptions } from '../../../packages/nuxt/src/module.js'
import { renderConfigJsonSchema } from '../../../packages/cli/src/config/schema-json.js'

const CONTENT_DIR = join(import.meta.dirname, '../../content')

/**
 * Options the Nuxt module accepts. Declared as a type-level assertion so this
 * list cannot silently fall behind `ModuleOptions`: adding an option without
 * adding it here fails to compile.
 */
const MODULE_OPTIONS = ['enabled', 'failOnInvalidConfig'] as const satisfies readonly (keyof ModuleOptions)[]

/** Fails to compile if `ModuleOptions` grows an option this list does not name. */
type Unlisted = Exclude<keyof ModuleOptions, typeof MODULE_OPTIONS[number]>
export type ModuleOptionsAreFullyListed = Unlisted extends never ? true : Unlisted

function configPages(): { name: string, text: string }[] {
  return readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { name: relative(CONTENT_DIR, path), text: readFileSync(path, 'utf-8') }
    })
}

/**
 * The property names an `i18nKit: { … }` block in the page sets.
 *
 * Parsed rather than pattern-matched. The first version of this test used a
 * negative lookahead inside the block, which a greedy prefix defeats: it finds
 * some position where the lookahead passes, so `i18nKit: { enabled: false }` —
 * a correct example — was reported as declaring policy.
 */
function i18nKitKeys(text: string): string[] {
  const keys: string[] = []
  for (const block of text.matchAll(/i18nKit:\s*\{([^}]*)\}/gs)) {
    const body = block[1] ?? ''
    for (const key of body.matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*:/g)) {
      keys.push(key[1] as string)
    }
  }
  return keys
}

describe('the configuration pages against the module the kit ships', () => {
  it('carries no policy option, so no page may describe one', () => {
    // The premise. If this fails, the module grew policy back and the
    // assertions below are the ones to revisit rather than delete.
    expect([...MODULE_OPTIONS]).toEqual(['enabled', 'failOnInvalidConfig'])
  })

  it('never presents an i18nKit block as a place policy is declared', () => {
    const allowed = new Set<string>(MODULE_OPTIONS)
    for (const { name, text } of configPages()) {
      // The module's own options may be named; anything else in that block is
      // policy the module stopped reading in #372.
      const policyKeys = i18nKitKeys(text).filter(key => !allowed.has(key))
      expect(policyKeys, `${name} shows policy inside an i18nKit block`).toEqual([])
    }
  })

  it('never counts nuxt.config.ts among the places policy lives', () => {
    for (const { name, text } of configPages()) {
      expect(text, `${name} still counts three declaration sites`)
        .not.toMatch(/declared in three places|## The Three Places/i)
    }
  })

  it('keeps the published schema description to the files that accept policy', () => {
    // Shipped in packages/mcp/schema.json and shown by editors on $schema hover,
    // which is why this one mattered more than the pages.
    const description = JSON.parse(renderConfigJsonSchema()).description as string
    expect(description).toContain('i18n-kit.config.ts')
    expect(description).toContain('.i18n-mcp.json')
    expect(description).not.toMatch(/nuxt\.config\.ts|all three/i)
  })
})
