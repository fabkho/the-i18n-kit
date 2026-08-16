import { describe, expect, it } from 'vitest'

import { createOxcFrontend } from '../../src/scanner/frontends/oxc.js'
import { interpret } from '../../src/scanner/rules.js'
import { VUE_NUXT_PATTERNS } from '../../src/scanner/patterns.js'

/**
 * The AST frontend (#332). It exists to answer the one question a regex
 * cannot: is this `t` the translation function, or someone's `emit`?
 *
 * Tests go through the frontend and the rules together, because neither means
 * anything alone — the frontend reports what it saw, the rules decide what it
 * means, and the seam between them is what makes a language pluggable.
 */

const frontend = createOxcFrontend()

async function scan(source: string, filePath = 'a.ts') {
  const sites = await frontend.read(source, filePath)
  if (!sites) return null

  return interpret(sites, {
    filePath,
    ambiguousCalleeNeedsDot: callee => VUE_NUXT_PATTERNS.requiresDotForCallee?.(callee) ?? false,
  })
}

describe('resolving what t is bound to', () => {
  // The #298 case. A regex has to guess from the dot; this knows.
  it('counts a dotless key as used when t came from useI18n', async () => {
    const evidence = await scan(`
      import { useI18n } from 'vue-i18n'
      const { t } = useI18n()
      const label = t('save')
    `)

    expect(evidence?.usages.map(u => u.key)).toEqual(['save'])
    expect(evidence?.bareStringCandidates.has('save')).toBe(false)
  })

  it('does not count a dotless key from a t it cannot place', async () => {
    const evidence = await scan(`const label = t('save')`)

    expect(evidence?.usages).toEqual([])
    // Protected rather than dropped: a key of that name still exists (#298).
    expect(evidence?.bareStringCandidates.has('save')).toBe(true)
  })

  it('ignores a call that is not a translation, however its argument looks', async () => {
    const evidence = await scan(`
      const client = axios.get('/api/v1.0/bookings')
      const mod = require('node:fs.promises')
    `)

    expect(evidence?.usages).toEqual([])
  })

  it('follows a factory imported under another name', async () => {
    const evidence = await scan(`
      import { useI18n as useTranslations } from 'vue-i18n'
      const { t: translate } = useTranslations()
      const label = translate('save')
    `)

    expect(evidence?.usages.map(u => u.key)).toEqual(['save'])
  })
})

describe('reading the argument', () => {
  it('resolves a template built from a constant into the key it names', async () => {
    const evidence = await scan(`
      const base = 'pages.settings'
      const label = t(\`\${base}.title\`)
    `)

    expect(evidence?.usages.map(u => u.key)).toEqual(['pages.settings.title'])
    expect(evidence?.dynamicKeys).toEqual([])
  })

  it('reports a template it cannot resolve as a dynamic key', async () => {
    const evidence = await scan('const label = t(`common.metrics.${metric}`)')

    expect(evidence?.usages).toEqual([])
    expect(evidence?.dynamicKeys[0]?.expression).toBe('`common.metrics.${_}`')
  })

  it('bounds a concatenation by its literal prefix', async () => {
    const evidence = await scan("const label = t('common.actions.' + name)")

    expect(evidence?.dynamicKeys[0]?.expression).toBe('`common.actions.${_}`')
  })

  it('reports nothing for an argument it cannot read', async () => {
    const evidence = await scan('const label = t(someKey)')

    expect(evidence?.usages).toEqual([])
    expect(evidence?.dynamicKeys).toEqual([])
  })

  it('treats a backtick string with no slots as a plain key', async () => {
    const evidence = await scan('const label = t(`common.save`)')

    expect(evidence?.usages.map(u => u.key)).toEqual(['common.save'])
  })
})

describe('Vue single-file components', () => {
  it('finds keys in the template as well as the script', async () => {
    const evidence = await scan(
      `<template><p>{{ $t('common.hello') }}</p></template>\n`
      + `<script setup>const label = $t('common.bye')</script>`,
      'A.vue',
    )

    expect(evidence?.usages.map(u => u.key).sort()).toEqual(['common.bye', 'common.hello'])
  })

  // An SFC is one scope split across blocks: the template uses what the script
  // declared, and collecting per block leaves the template's keys unresolvable.
  it('resolves a template key from a constant declared in the script', async () => {
    const evidence = await scan(
      `<template><p>{{ t(\`\${base}.title\`) }}</p></template>\n`
      + `<script setup>\nimport { useI18n } from 'vue-i18n'\nconst { t } = useI18n()\nconst base = 'pages.settings'\n</script>`,
      'A.vue',
    )

    expect(evidence?.usages.map(u => u.key)).toContain('pages.settings.title')
  })

  it('reports the line a key was used on, not the line of its block', async () => {
    const evidence = await scan(
      `<template>\n  <p>{{ $t('a.b') }}</p>\n</template>\n<script setup>\n\nconst x = $t('c.d')\n</script>`,
      'A.vue',
    )

    const cd = evidence?.usages.find(u => u.key === 'c.d')
    expect(cd?.line).toBe(6)
  })
})

describe('declining a file', () => {
  // Declining sends the file to the pattern matcher. Returning nothing would
  // silently drop every key it contains, which is the direction that deletes
  // someone's translations.
  it('declines a file it cannot parse rather than reporting it as empty', async () => {
    expect(await frontend.read('const = = =', 'broken.ts')).toBeNull()
  })

  it('declines an SFC with no block it recognises', async () => {
    expect(await frontend.read("const label = t('a.b')", 'odd.vue')).toBeNull()
  })

  it('reads only the languages it claims', () => {
    expect(frontend.handles('a.ts')).toBe(true)
    expect(frontend.handles('a.vue')).toBe(true)
    expect(frontend.handles('a.php')).toBe(false)
    expect(frontend.handles('a.blade.php')).toBe(false)
  })
})
