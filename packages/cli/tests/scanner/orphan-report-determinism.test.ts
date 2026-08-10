/**
 * Byte-determinism of orphan-scan diagnostics (#263): when several files
 * produce the same suggestedIgnorePattern, the surviving representative in
 * unresolvedKeyWarnings must not depend on file discovery order — CI artifact
 * diffing relies on two consecutive runs being byte-identical.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findOrphanKeysForConfig } from '../../src/scanner/code-scanner.js'

let baseDir: string
let dirA: string
let dirB: string

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'i18n-determinism-'))
  dirA = join(baseDir, 'unit-a')
  dirB = join(baseDir, 'unit-b')
  await mkdir(dirA, { recursive: true })
  await mkdir(dirB, { recursive: true })

  // Three files whose dynamic expressions all suggest `common.pay.**`.
  // The lexicographically-latest file is written FIRST so plain creation
  // order differs from the expected lexicographic representative.
  await writeFile(join(dirB, 'zz-late.vue'), 'const c = t(`common.pay.${mode}.title`)\n')
  await writeFile(join(dirA, 'zz-intra.vue'), 'const b = t(`common.pay.${type}.title`)\n')
  await writeFile(join(dirA, 'aa-early.vue'), '\n\nconst a = t(`common.pay.${kind}.title`)\n')
})

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

const run = (scanDirs: string[]) => findOrphanKeysForConfig({
  keysByLayer: new Map([
    ['root', { keys: ['common.pay.card.title', 'some.orphan'], localeDir: { layer: 'root' } }],
  ]),
  scanDirs,
  resolveIgnorePatterns: () => undefined,
})

describe('unresolvedKeyWarnings determinism (#263)', () => {
  it('two consecutive runs produce byte-identical results', async () => {
    const first = await run([dirA, dirB])
    const second = await run([dirA, dirB])

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('representative location survives scan-order perturbation and is the lexicographically smallest', async () => {
    // Reversing the unit order reverses raw dynamic-key accumulation order —
    // the pre-sort dedupe would have picked a different representative.
    const forward = await run([dirA, dirB])
    const reversed = await run([dirB, dirA])

    expect(reversed.unresolvedKeyWarnings).toEqual(forward.unresolvedKeyWarnings)
    expect(reversed.allDynamicKeys).toEqual(forward.allDynamicKeys)

    expect(forward.unresolvedKeyWarnings).toHaveLength(1)
    const warning = forward.unresolvedKeyWarnings[0]!
    expect(warning.suggestedIgnorePattern).toBe('common.pay.**')
    expect(warning.file).toBe(join(dirA, 'aa-early.vue'))
    expect(warning.line).toBe(3)
  })
})
