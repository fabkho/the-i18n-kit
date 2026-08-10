/**
 * GitLab Code Quality mapping (#270) — pure transforms, no I/O.
 *
 * Contract under test: every issue carries the full required field set,
 * paths are project-root-relative with no leading `./`, lines.begin is an
 * integer ≥ 1, and fingerprints are line-independent (edits that shift a
 * usage must not churn findings as new/resolved in the MR widget).
 */

import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'

import type { I18nConfig } from '../../src/config/types.js'
import type { UndefinedKeyFinding } from '../../src/core/ops-check.js'
import {
  undefinedKeysToCodeQuality,
  orphanKeysToCodeQuality,
  referenceLocaleAnchorPaths,
} from '../../src/core/codequality.js'
import type { CodeQualityIssue } from '../../src/core/codequality.js'

const finding = (key: string, usages: Array<{ file: string; line: number }>): UndefinedKeyFinding =>
  ({ key, app: 'app', searchedLayers: ['root'], usages })

function expectValidIssue(issue: CodeQualityIssue): void {
  expect(issue.description).toEqual(expect.any(String))
  expect(issue.description.length).toBeGreaterThan(0)
  expect(issue.check_name).toMatch(/^i18n\./)
  expect(issue.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  expect(['info', 'minor', 'major', 'critical', 'blocker']).toContain(issue.severity)
  expect(issue.location.path).toEqual(expect.any(String))
  expect(issue.location.path).not.toMatch(/^\.\//)
  expect(issue.location.path).not.toMatch(/^\//)
  expect(Number.isInteger(issue.location.lines.begin)).toBe(true)
  expect(issue.location.lines.begin).toBeGreaterThanOrEqual(1)
}

describe('undefinedKeysToCodeQuality', () => {
  it('maps one major finding per usage location', () => {
    const issues = undefinedKeysToCodeQuality([
      finding('a.b', [{ file: 'src/App.vue', line: 3 }, { file: 'src/Other.vue', line: 7 }]),
      finding('c.d', [{ file: 'src/App.vue', line: 9 }]),
    ])

    expect(issues).toHaveLength(3)
    for (const issue of issues) expectValidIssue(issue)
    expect(issues[0]).toMatchObject({
      check_name: 'i18n.undefined-key',
      severity: 'major',
      location: { path: 'src/App.vue', lines: { begin: 3 } },
    })
    expect(issues[0]!.description).toContain('"a.b"')
  })

  it('fingerprints are line-independent but key- and path-sensitive', () => {
    const at = (line: number): CodeQualityIssue[] =>
      undefinedKeysToCodeQuality([finding('a.b', [{ file: 'src/App.vue', line }])])

    // Frozen vector: sha256 over check_name, key, path — changing this hash
    // resets every consumer's new/resolved state in the widget.
    expect(at(3)[0]!.fingerprint).toBe('0998722d98ee09e187b0b2683a90d831966e193bb63c9782de439a8d0a559158')
    expect(at(300)[0]!.fingerprint).toBe(at(3)[0]!.fingerprint)

    const otherKey = undefinedKeysToCodeQuality([finding('a.c', [{ file: 'src/App.vue', line: 3 }])])
    const otherFile = undefinedKeysToCodeQuality([finding('a.b', [{ file: 'src/B.vue', line: 3 }])])
    expect(otherKey[0]!.fingerprint).not.toBe(at(3)[0]!.fingerprint)
    expect(otherFile[0]!.fingerprint).not.toBe(at(3)[0]!.fingerprint)
  })

  it('normalizes path shape and clamps lines.begin to an integer ≥ 1', () => {
    const issues = undefinedKeysToCodeQuality([
      finding('a.b', [{ file: './src\\win\\App.vue', line: 0 }]),
    ])

    expect(issues[0]!.location).toEqual({ path: 'src/win/App.vue', lines: { begin: 1 } })
  })

  it('maps an empty result to an empty array (the default-branch baseline)', () => {
    expect(undefinedKeysToCodeQuality([])).toEqual([])
  })
})

describe('orphanKeysToCodeQuality', () => {
  const anchors = { 'root': 'i18n/locales/de-DE.json', 'app-admin': 'app-admin/i18n/locales/de-DE.json' }

  it('maps one minor finding per key, anchored at the reference-locale file, line 1', () => {
    const issues = orphanKeysToCodeQuality(
      { 'root': ['a.b', 'a.c'], 'app-admin': ['admin.x'] },
      anchors,
    )

    expect(issues).toHaveLength(3)
    for (const issue of issues) expectValidIssue(issue)
    expect(issues[0]).toMatchObject({
      check_name: 'i18n.orphan-key',
      severity: 'minor',
      location: { path: 'i18n/locales/de-DE.json', lines: { begin: 1 } },
    })
    expect(issues[2]!.location.path).toBe('app-admin/i18n/locales/de-DE.json')
    expect(issues[0]!.description).toContain('"a.b"')
    expect(issues[0]!.description).toContain('verify before deleting')
  })

  it('fingerprints depend on layer + key, not the anchor path', () => {
    const [issue] = orphanKeysToCodeQuality({ root: ['a.b'] }, anchors)
    const [moved] = orphanKeysToCodeQuality({ root: ['a.b'] }, { root: 'renamed/locales/en.json' })

    expect(issue!.fingerprint).toBe('7b340a6a9273b1d9346c77ec83a1723b01f710da22356dfd67a963bd2d6e6557')
    expect(moved!.fingerprint).toBe(issue!.fingerprint)

    const [otherLayer] = orphanKeysToCodeQuality({ other: ['a.b'] }, { other: 'x.json' })
    expect(otherLayer!.fingerprint).not.toBe(issue!.fingerprint)
  })
})

describe('referenceLocaleAnchorPaths', () => {
  const projectDir = resolve('/proj')
  const config = {
    localeDirs: [
      { path: resolve('/proj/i18n/locales'), layer: 'root', layerRootDir: projectDir },
      { path: resolve('/proj/app-shop/i18n/locales'), layer: 'app-shop', layerRootDir: resolve('/proj/app-shop') },
      { path: resolve('/proj/app-shop/i18n/locales'), layer: 'app-outlook', layerRootDir: resolve('/proj/app-outlook'), aliasOf: 'app-shop' },
    ],
  } as I18nConfig
  const locale = { code: 'de', language: 'de-DE', file: 'de-DE.json' }

  it('resolves flat layouts to the locale file, relative without leading ./', () => {
    const anchors = referenceLocaleAnchorPaths(config, ['root', 'app-shop'], locale, projectDir)

    expect(anchors).toEqual({
      'root': 'i18n/locales/de-DE.json',
      'app-shop': 'app-shop/i18n/locales/de-DE.json',
    })
  })

  it('aliases anchor at their target layer\'s directory', () => {
    const anchors = referenceLocaleAnchorPaths(config, ['app-outlook'], locale, projectDir)

    expect(anchors['app-outlook']).toBe('app-shop/i18n/locales/de-DE.json')
  })

  it('locales without a file (namespaced layouts) anchor at the locale directory', () => {
    const anchors = referenceLocaleAnchorPaths(config, ['root'], { code: 'de', language: 'de-DE' }, projectDir)

    expect(anchors['root']).toBe('i18n/locales/de')
  })
})
