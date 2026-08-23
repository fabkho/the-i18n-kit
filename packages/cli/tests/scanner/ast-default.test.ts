import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanSourceFiles, findOrphanKeysForConfig } from '../../src/scanner/code-scanner.js'

/**
 * The flip (#402): the syntax frontend is the default scanner, patterns read
 * only what it declines, and I18N_SCANNER=regex is a one-release escape hatch.
 * Tests assert scan conclusions, never which parser produced them.
 */

const tmpDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp-test/ast-default')

beforeAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.I18N_SCANNER
})

describe('the syntax frontend is the default', () => {
  it('resolves what t is bound to without any flag', async () => {
    await writeFile(join(tmpDir, 'resolved.ts'), [
      `import { useI18n } from 'vue-i18n'`,
      `const { t } = useI18n()`,
      `const label = t('save')`,
      `emit('not.a.translation')`,
    ].join('\n'))

    const result = await scanSourceFiles(tmpDir)

    // A resolved dotless key is a usage; a call that is not a translation is
    // not, however key-shaped its argument looks.
    expect(result.uniqueKeys.has('save')).toBe(true)
    expect(result.uniqueKeys.has('not.a.translation')).toBe(false)
    expect(result.declinedFiles).toEqual([])
  })

  it('counts the files that fell back to pattern matching', async () => {
    // Not an SFC: bare statements the block splitter cannot see into. The
    // syntax frontend declines it, patterns read it, and the scan says so.
    await writeFile(join(tmpDir, 'NotAnSfc.vue'), `const label = $t('fallback.read')`)

    const result = await scanSourceFiles(tmpDir)

    expect(result.declinedFiles).toEqual(['NotAnSfc.vue'])
    expect(result.uniqueKeys.has('fallback.read')).toBe(true)
  })

  it('I18N_SCANNER=regex restores the pattern scanner', async () => {
    process.env.I18N_SCANNER = 'regex'

    const result = await scanSourceFiles(tmpDir)

    // The regex cannot place a bare dotless t('save'); it stays a candidate.
    expect(result.uniqueKeys.has('save')).toBe(false)
    expect(result.bareStringCandidates.has('save')).toBe(true)
  })
})

describe('inline string templates (options API)', () => {
  // defineComponent({ template: '...' }) — the $t inside is a string, not a
  // call site, and the scanner will not claim a call it cannot prove. The
  // key is not a usage; the dotted string keeps it out of the orphan bucket
  // via the bare-candidate net, same as a comment reference.
  it('reads the template as the string it is, net-protected', async () => {
    await writeFile(join(tmpDir, 'options-api.ts'), [
      `import { defineComponent } from 'vue'`,
      `export default defineComponent({`,
      `  template: '<p>{{ $t("inline.template.key") }}</p>',`,
      `})`,
    ].join('\n'))

    const result = await scanSourceFiles(tmpDir)

    expect(result.uniqueKeys.has('inline.template.key')).toBe(false)
    expect(result.bareStringCandidates.has('inline.template.key')).toBe(true)
  })
})

describe('protected only by candidates (#402)', () => {
  it('surfaces keys alive solely through the bare-candidate net', async () => {
    const dir = join(tmpDir, 'candidate-only')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'app.ts'), [
      `import { useI18n } from 'vue-i18n'`,
      `const { t } = useI18n()`,
      `const label = t('really.used')`,
      `// example: t('widgets.bookings.title') — reference lives in a comment`,
    ].join('\n'))

    const result = await findOrphanKeysForConfig({
      keysByLayer: new Map([['root', {
        keys: ['really.used', 'widgets.bookings.title', 'gone.for.good'],
        localeDir: { layer: 'root' },
      }]]),
      resolveIgnorePatterns: () => undefined,
      scanDirs: [dir],
    })

    // Comment-only reference: not an orphan, but visibly candidate-only.
    expect(result.candidateOnlyByLayer.root).toEqual(['widgets.bookings.title'])
    expect(result.candidateOnlyCount).toBe(1)
    expect(result.orphansByLayer.root).toEqual(['gone.for.good'])
    expect(result.orphansByLayer.root).not.toContain('widgets.bookings.title')
  })
})
