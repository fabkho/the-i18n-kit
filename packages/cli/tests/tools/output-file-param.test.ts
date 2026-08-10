/**
 * Tests for the `outputFile` parameter on large-output operations.
 *
 * Verifies:
 * - When `outputFile` is provided, op writes JSON to disk and returns `{ reportFile, summary }`.
 * - Relative paths resolve against the project dir, not the process cwd (#266).
 * - Paths outside the project directory are rejected even when `outputFile` is explicit.
 * - When `outputFile` is absent and no config-level `reportOutput`, full payload is returned inline.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { registerDetectorMock, playgroundDir, appAdminDir } from '../fixtures/mock-detector.js'

// Register the shared detector mock (vi.mock is hoisted by Vitest)
registerDetectorMock()

const { clearConfigCache } = await import('../../src/config/detector.js')

import {
  getMissingTranslations,
  findEmptyTranslations,
  findOrphanKeys,
  scanCodeUsage,
  removeOrphanKeys,
} from '../../src/core/operations.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'i18n-kit-test-'))
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

afterEach(() => {
  clearConfigCache()
})

// ─── getMissingTranslations ──────────────────────────────────────────────────

describe('getMissingTranslations — outputFile', () => {
  it('writes full JSON to disk and returns { reportFile, summary }', async () => {
    const outPath = join(appAdminDir, '.i18n-reports', 'missing.json')
    const result = await getMissingTranslations({
      projectDir: appAdminDir,
      outputFile: outPath,
    })

    expect(result).toHaveProperty('reportFile', outPath)
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('missing')

    const raw = await readFile(outPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('tool', 'get_missing_translations')
    expect(parsed).toHaveProperty('missing')
  })

  it('resolves a relative outputFile against the project dir, not the process cwd', async () => {
    const result = await getMissingTranslations({
      projectDir: appAdminDir,
      outputFile: '.i18n-reports/missing-rel.json',
    })
    expect(result).toHaveProperty('reportFile', join(appAdminDir, '.i18n-reports', 'missing-rel.json'))
    const raw = await readFile(join(appAdminDir, '.i18n-reports', 'missing-rel.json'), 'utf-8')
    expect(JSON.parse(raw)).toHaveProperty('tool', 'get_missing_translations')
  })

  it('rejects an outputFile outside the project dir', async () => {
    const outPath = join(tmpDir, 'missing-tmp.json')
    await expect(
      getMissingTranslations({ projectDir: appAdminDir, outputFile: outPath }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('rejects a relative outputFile escaping the project dir', async () => {
    await expect(
      getMissingTranslations({ projectDir: appAdminDir, outputFile: '../escape.json' }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('returns full inline payload when outputFile is absent', async () => {
    const result = await getMissingTranslations({ projectDir: appAdminDir })
    expect(result).toHaveProperty('missing')
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('reportFile')
  })
})

// ─── findEmptyTranslations ───────────────────────────────────────────────────

describe('findEmptyTranslations — outputFile', () => {
  it('writes full JSON to disk and returns { reportFile, summary }', async () => {
    const outPath = join(appAdminDir, '.i18n-reports', 'empty.json')
    const result = await findEmptyTranslations({
      projectDir: appAdminDir,
      outputFile: outPath,
    })

    expect(result).toHaveProperty('reportFile', outPath)
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('emptyKeys')

    const raw = await readFile(outPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('tool', 'find_empty_translations')
    expect(parsed).toHaveProperty('emptyKeys')
  })

  it('rejects an outputFile outside the project dir', async () => {
    const outPath = join(tmpDir, 'empty-tmp.json')
    await expect(
      findEmptyTranslations({ projectDir: appAdminDir, outputFile: outPath }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('returns full inline payload when outputFile is absent', async () => {
    const result = await findEmptyTranslations({ projectDir: appAdminDir })
    expect(result).toHaveProperty('emptyKeys')
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('reportFile')
  })
})

// ─── findOrphanKeys ─────────────────────────────────────────────────────────

describe('findOrphanKeys — outputFile', () => {
  it('writes full JSON to disk and returns { reportFile, summary }', async () => {
    const outPath = join(playgroundDir, '.i18n-reports', 'orphans.json')
    const result = await findOrphanKeys({
      projectDir: playgroundDir,
      outputFile: outPath,
    })

    expect(result).toHaveProperty('reportFile', outPath)
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('orphanKeys')

    const raw = await readFile(outPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('tool', 'find_orphan_keys')
    expect(parsed).toHaveProperty('orphanKeys')
  })

  it('rejects an outputFile outside the project dir', async () => {
    const outPath = join(tmpDir, 'orphans-tmp.json')
    await expect(
      findOrphanKeys({ projectDir: playgroundDir, outputFile: outPath }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('returns full inline payload when outputFile is absent', async () => {
    const result = await findOrphanKeys({ projectDir: playgroundDir })
    expect(result).toHaveProperty('orphanKeys')
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('reportFile')
  })
})

// ─── scanCodeUsage ───────────────────────────────────────────────────────────

describe('scanCodeUsage — outputFile', () => {
  it('writes full JSON to disk and returns { reportFile, summary }', async () => {
    const outPath = join(playgroundDir, '.i18n-reports', 'scan.json')
    const result = await scanCodeUsage({
      projectDir: playgroundDir,
      outputFile: outPath,
    })

    expect(result).toHaveProperty('reportFile', outPath)
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('usages')

    const raw = await readFile(outPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('tool', 'scan_code_usage')
    expect(parsed).toHaveProperty('usages')
  })

  it('rejects an outputFile outside the project dir', async () => {
    const outPath = join(tmpDir, 'scan-tmp.json')
    await expect(
      scanCodeUsage({ projectDir: playgroundDir, outputFile: outPath }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('returns full inline payload when outputFile is absent', async () => {
    const result = await scanCodeUsage({ projectDir: playgroundDir })
    expect(result).toHaveProperty('usages')
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('reportFile')
  })
})

// ─── removeOrphanKeys ───────────────────────────────────────────────

describe('removeOrphanKeys — outputFile', () => {
  it('writes full JSON to disk and returns { reportFile, summary } in dry-run mode', async () => {
    const outPath = join(playgroundDir, '.i18n-reports', 'cleanup.json')
    const result = await removeOrphanKeys({
      projectDir: playgroundDir,
      dryRun: true,
      outputFile: outPath,
    })

    expect(result).toHaveProperty('reportFile', outPath)
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('orphanKeys')

    const raw = await readFile(outPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveProperty('tool', 'remove_orphan_keys')
  })

  it('resolves a relative outputFile against the project dir in dry-run mode', async () => {
    const result = await removeOrphanKeys({
      projectDir: playgroundDir,
      dryRun: true,
      outputFile: '.i18n-reports/cleanup-rel.json',
    })
    expect(result).toHaveProperty('reportFile', join(playgroundDir, '.i18n-reports', 'cleanup-rel.json'))
  })

  it('rejects a relative outputFile escaping the project dir', async () => {
    await expect(
      removeOrphanKeys({ projectDir: playgroundDir, dryRun: true, outputFile: '../escape.json' }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('rejects paths outside project dir (internal auto-generated paths are validated)', async () => {
    const outPath = join(tmpDir, 'cleanup-tmp.json')
    await expect(
      removeOrphanKeys({ projectDir: playgroundDir, dryRun: true, outputFile: outPath }),
    ).rejects.toThrow(/resolves outside the project directory/)
  })

  it('returns full inline payload when outputFile is absent', async () => {
    const result = await removeOrphanKeys({ projectDir: playgroundDir, dryRun: true })
    expect(result).toHaveProperty('summary')
    expect(result).not.toHaveProperty('reportFile')
  })
})
