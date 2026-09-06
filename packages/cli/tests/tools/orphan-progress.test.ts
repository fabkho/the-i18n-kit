/**
 * Progress reporting for the orphan scans — the contract the MCP reporter on
 * the other end is written against: the total arrives before the first step,
 * every step is counted, the last one lands exactly on the total, and a
 * project with more files than steps still sends at most ~100 notifications.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTempMultiAppConfig } from '../fixtures/config.js'

const holder = vi.hoisted(() => ({ config: undefined as unknown }))
vi.mock('../../src/config/detector.js', async importOriginal =>
  (await import('../fixtures/holder-detector.js')).holderDetectorMock(holder, importOriginal))

const { findOrphanKeys, removeOrphanKeys } = await import('../../src/core/operations.js')

let projectDir: string
let bigProjectDir: string

/**
 * The two callbacks in one timeline, because their order is the point: a
 * notification sent before the total has nothing to be a fraction of.
 */
function recorder() {
  const events: string[] = []
  const messages: string[] = []
  return {
    events,
    messages,
    onProgressTotal: (total: number) => { events.push(`total:${total}`) },
    progressFn: async (message: string) => {
      events.push('step')
      messages.push(message)
    },
  }
}

/** The announced total, read off the timeline; -1 when it was never announced. */
const announcedTotal = (events: string[]): number =>
  Number(events.find(e => e.startsWith('total:'))?.slice('total:'.length) ?? -1)

const stepCount = (events: string[]): number => events.filter(e => e === 'step').length

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-orphan-progress-'))
  const adminDir = join(projectDir, 'app-admin')
  const shopDir = join(projectDir, 'app-shop')

  await mkdir(join(projectDir, 'components'), { recursive: true })
  await writeFile(join(projectDir, 'components/Shared.vue'), `{{ $t('root.used') }}`)
  for (const [appDir, key] of [[adminDir, 'admin'], [shopDir, 'shop']] as const) {
    await mkdir(join(appDir, 'pages'), { recursive: true })
    await writeFile(join(appDir, 'pages/index.vue'), `{{ $t('${key}.used') }}`)
    await writeFile(join(appDir, 'pages/detail.vue'), `{{ $t('${key}.used') }}`)
  }

  for (const [dir, data] of [
    [projectDir, { root: { used: 'a', orphan: 'b' } }],
    [adminDir, { admin: { used: 'a', orphan: 'b' } }],
    [shopDir, { shop: { used: 'a' } }],
  ] as const) {
    await mkdir(join(dir, 'i18n/locales'), { recursive: true })
    await writeFile(join(dir, 'i18n/locales/de-DE.json'), JSON.stringify(data))
  }

  // A project big enough that reporting every file would flood the caller.
  bigProjectDir = await mkdtemp(join(tmpdir(), 'i18n-orphan-progress-big-'))
  await mkdir(join(bigProjectDir, 'components'), { recursive: true })
  for (let i = 0; i < 210; i++) {
    await writeFile(join(bigProjectDir, `components/C${i}.vue`), `{{ $t('root.used') }}`)
  }
  await mkdir(join(bigProjectDir, 'i18n/locales'), { recursive: true })
  await writeFile(join(bigProjectDir, 'i18n/locales/de-DE.json'), JSON.stringify({
    root: { used: 'a', orphan: 'b' },
  }))
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
  await rm(bigProjectDir, { recursive: true, force: true })
})

describe('orphan scan progress', () => {
  it('announces the total once, before the first step, and ends on it', async () => {
    holder.config = createTempMultiAppConfig(projectDir)
    const rec = recorder()

    const result = await findOrphanKeys({
      projectDir,
      progressFn: rec.progressFn,
      onProgressTotal: rec.onProgressTotal,
    })

    expect(rec.events.filter(e => e.startsWith('total:'))).toHaveLength(1)
    // The invariant: nothing is reported against an unknown total.
    expect(rec.events[0]).toBe(`total:${announcedTotal(rec.events)}`)
    // Below the stride threshold one step is one file, so the two agree.
    expect(result.summary.filesScanned).toBeGreaterThan(0)
    expect(announcedTotal(rec.events)).toBe(result.summary.filesScanned)
    expect(stepCount(rec.events)).toBe(announcedTotal(rec.events))
  })

  it('names the app and the file the scan is in', async () => {
    holder.config = createTempMultiAppConfig(projectDir)
    const rec = recorder()

    await findOrphanKeys({
      projectDir,
      progressFn: rec.progressFn,
      onProgressTotal: rec.onProgressTotal,
    })

    expect(rec.messages.some(m => m.includes('app-admin') && m.includes('index.vue'))).toBe(true)
    expect(rec.messages.some(m => m.includes('app-shop'))).toBe(true)
  })

  it('reports the removal scan the same way', async () => {
    holder.config = createTempMultiAppConfig(projectDir)
    const rec = recorder()

    // dryRun so the fixture's locale files survive the assertion below.
    await removeOrphanKeys({
      projectDir,
      dryRun: true,
      progressFn: rec.progressFn,
      onProgressTotal: rec.onProgressTotal,
    })

    expect(rec.events[0]).toMatch(/^total:\d+$/)
    expect(stepCount(rec.events)).toBeGreaterThan(0)
    expect(stepCount(rec.events)).toBe(announcedTotal(rec.events))
  })

  it('strides over the files of a large project instead of reporting each one', async () => {
    holder.config = {
      ...createTempMultiAppConfig(bigProjectDir),
      localeDirs: [{ path: join(bigProjectDir, 'i18n/locales'), layer: 'root', layerRootDir: bigProjectDir }],
      layerRootDirs: [bigProjectDir],
      apps: [{ name: 'root', rootDir: bigProjectDir, layers: ['root'] }],
    }
    const rec = recorder()

    const result = await findOrphanKeys({
      projectDir: bigProjectDir,
      progressFn: rec.progressFn,
      onProgressTotal: rec.onProgressTotal,
    })

    expect(result.summary.filesScanned).toBeGreaterThan(100)
    expect(announcedTotal(rec.events)).toBeLessThanOrEqual(100)
    // Fewer steps than files, and the last step still lands on the total.
    expect(announcedTotal(rec.events)).toBeLessThan(result.summary.filesScanned)
    expect(stepCount(rec.events)).toBe(announcedTotal(rec.events))
  })

  it('scans exactly as before when no progress callbacks are passed', async () => {
    holder.config = createTempMultiAppConfig(projectDir)

    const withProgress = await findOrphanKeys({
      projectDir,
      progressFn: async () => {},
      onProgressTotal: () => {},
    })
    const without = await findOrphanKeys({ projectDir })

    expect(without.orphanKeys).toEqual(withProgress.orphanKeys)
    expect(without.summary.filesScanned).toBe(withProgress.summary.filesScanned)
  })
})
