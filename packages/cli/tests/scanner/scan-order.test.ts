/**
 * Files are read and parsed with several in flight at once, so completion
 * order no longer matches input order. Everything the scanner returns must
 * still be assembled in input (sorted-path) order — scan order is output
 * order, and CI artifact diffing relies on two runs being byte-identical.
 *
 * The fixture is sized past the concurrency window and front-loaded with
 * padding, so the first files are the slowest to parse: assembled by
 * completion, the output would come back shuffled.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanSourceFiles } from '../../src/scanner/code-scanner.js'

const FILE_COUNT = 50

let scanDir: string

const id = (index: number): string => `mod${String(index).padStart(3, '0')}`

/** Dot-free filler, so it contributes no key evidence of its own. */
const padding = (index: number): string => {
  const lines = (FILE_COUNT - index) * 40
  return Array.from({ length: lines }, (_, n) => `const filler${index}_${n} = 'lorem ipsum dolor sit amet ${n}'`).join('\n')
}

const source = (index: number): string => [
  padding(index),
  `const title = $t('${id(index)}.title')`,
  `const body = $t(\`${id(index)}.\${kind}.body\`)`,
  `const bare = 'bare.${id(index)}.candidate'`,
  '',
].join('\n')

/** The `modNNN` index each string carries, in the order the scanner reported them. */
const indicesIn = (values: Iterable<string>): number[] =>
  [...values].map(v => Number(/mod(\d+)/.exec(v)?.[1] ?? -1))

/** Non-descending: one file can contribute several entries, but never after a later file's. */
const isInFileOrder = (values: number[]): boolean => values.every((v, i) => i === 0 || v >= values[i - 1]!)

beforeAll(async () => {
  scanDir = await mkdtemp(join(tmpdir(), 'i18n-scan-order-'))
  await Promise.all(
    Array.from({ length: FILE_COUNT }, (_, i) => writeFile(join(scanDir, `${id(i)}.ts`), source(i))),
  )
})

afterAll(async () => {
  await rm(scanDir, { recursive: true, force: true })
})

describe('scan assembly order over many files', () => {
  it('reports usages in sorted-path order, not completion order', async () => {
    const { usages, filesScanned } = await scanSourceFiles(scanDir)

    expect(filesScanned).toBe(FILE_COUNT)
    expect(usages.map(u => u.key)).toEqual(Array.from({ length: FILE_COUNT }, (_, i) => `${id(i)}.title`))
    expect(usages.map(u => u.file)).toEqual(Array.from({ length: FILE_COUNT }, (_, i) => join(scanDir, `${id(i)}.ts`)))
  })

  it('accumulates dynamic keys and both candidate sets in sorted-path order', async () => {
    const { dynamicKeys, bareStringCandidates, bareDynamicCandidates } = await scanSourceFiles(scanDir)

    expect(dynamicKeys).toHaveLength(FILE_COUNT)
    expect(isInFileOrder(indicesIn(dynamicKeys.map(d => d.expression)))).toBe(true)
    expect(dynamicKeys.map(d => d.file)).toEqual(Array.from({ length: FILE_COUNT }, (_, i) => join(scanDir, `${id(i)}.ts`)))

    // Set iteration order is insertion order, so these carry the same contract.
    expect(new Set(indicesIn(bareStringCandidates)).size).toBe(FILE_COUNT)
    expect(isInFileOrder(indicesIn(bareStringCandidates))).toBe(true)
    expect(new Set(indicesIn(bareDynamicCandidates)).size).toBe(FILE_COUNT)
    expect(isInFileOrder(indicesIn(bareDynamicCandidates))).toBe(true)
  })

  it('produces byte-identical results across consecutive runs', async () => {
    const serialize = (r: Awaited<ReturnType<typeof scanSourceFiles>>) => JSON.stringify({
      ...r,
      uniqueKeys: [...r.uniqueKeys],
      bareStringCandidates: [...r.bareStringCandidates],
      bareDynamicCandidates: [...r.bareDynamicCandidates],
    })

    const first = await scanSourceFiles(scanDir)
    const second = await scanSourceFiles(scanDir)

    expect(serialize(second)).toBe(serialize(first))
  })
})
