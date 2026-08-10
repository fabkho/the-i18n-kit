/**
 * Orphan report shape and config validation (#263, #265):
 * - dynamicKeys entries synthesized from bare candidates carry NO file/line
 *   (relativizing their empty file path would embed the process cwd);
 * - unknown `orphanScan` layer keys warn on stderr instead of silently
 *   no-op'ing, while valid keys keep applying their ignorePatterns.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { log } from '../../src/utils/logger.js'
import type { I18nConfig } from '../../src/config/types.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const { findOrphanKeys } = await import('../../src/core/operations.js')

let projectDir: string

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-report-shape-'))

  await mkdir(join(projectDir, 'pages'), { recursive: true })
  await writeFile(join(projectDir, 'pages/index.vue'), [
    `{{ $t('home.title') }}`,
    'const label = t(`dyn.stuff.${x}`)',
    // Bare dynamic template outside any i18n call — collected as a bare
    // candidate with no source location.
    'const p = `bare.path.${id}`',
  ].join('\n'))

  await mkdir(join(projectDir, 'i18n/locales'), { recursive: true })
  await writeFile(join(projectDir, 'i18n/locales/de-DE.json'), JSON.stringify({
    home: { title: 'a' },
    legal: { terms: 'b' },
    validation: { custom: 'c' },
  }))

  const config: I18nConfig = {
    rootDir: projectDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: [{ code: 'de', language: 'de-DE', file: 'de-DE.json' }],
    localeDirs: [
      { path: join(projectDir, 'i18n/locales'), layer: 'root', layerRootDir: projectDir },
    ],
    layerRootDirs: [projectDir],
    apps: [{ name: 'root', rootDir: projectDir, layers: ['root'] }],
    projectConfig: {
      orphanScan: {
        // Unknown layer name (#265) — the adapter names the layer "root".
        lang: { ignorePatterns: ['validation.**'] },
        root: { ignorePatterns: ['legal.**'] },
      },
    },
  }
  holder.config = config
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
})

describe('dynamicKeys report shape (#263)', () => {
  it('bare-candidate entries omit file/line; located entries stay relative', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      const result = await findOrphanKeys({ projectDir })
      const dynamicKeys = result.dynamicKeys as Array<Record<string, unknown>>

      const bare = dynamicKeys.find(dk => dk.expression === '`bare.path.${_}`')
      expect(bare).toBeDefined()
      expect(bare).not.toHaveProperty('file')
      expect(bare).not.toHaveProperty('line')

      const located = dynamicKeys.find(dk => dk.expression === '`dyn.stuff.${x}`')
      expect(located?.file).toBe(join('pages', 'index.vue'))
      expect(located?.line).toBe(2)

      // No cwd-dependent paths anywhere in the report.
      for (const dk of dynamicKeys) {
        expect(String(dk.file ?? '')).not.toContain('..')
      }
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('orphanScan layer-key validation (#265)', () => {
  it('warns for unknown layer keys and still applies valid ones', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      const result = await findOrphanKeys({ projectDir })
      const messages = warnSpy.mock.calls.map(args => args.join(' '))

      const unknownWarning = messages.find(m => m.includes('"lang"'))
      expect(unknownWarning).toBeDefined()
      expect(unknownWarning).toContain('Detected layers: root')
      // The known key must not be warned about.
      expect(messages.some(m => m.includes('orphanScan config key "root"'))).toBe(false)

      // Valid key applied: legal.** ignored. Unknown key no-op'd (no magic
      // single-layer aliasing): validation.custom stays an orphan.
      const summary = result.summary as Record<string, unknown>
      expect(summary.ignoredCount).toBe(1)
      expect((result.orphanKeys as Record<string, string[]>).root).toEqual(['validation.custom'])
    } finally {
      warnSpy.mockRestore()
    }
  })
})
