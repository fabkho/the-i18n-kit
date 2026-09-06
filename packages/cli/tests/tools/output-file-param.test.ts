/**
 * Diverting a large result to a file — the contract CI depends on.
 *
 * The diversion is applied by the surface, not by the operations, so it is
 * tested through the CLI runner: every descriptor that declares a report is
 * driven through the command built from it, which means an operation that
 * grows a report cannot slip past this file untested.
 *
 * What is asserted is what users have in their pipelines: the caller gets
 * `{ reportFile, summary }` and nothing else, the file holds the whole result,
 * the file a configured `reportOutput` picks is `<dir>/<tool name>.json` with
 * the tool name each operation has always written under, and a path escaping
 * the project is refused.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// writeResult bypasses stdout spies via a bound reference captured at module
// load — mock the guard so command output stays out of the test stream.
vi.mock('../../src/utils/stdout-guard.js', () => ({
  guardStdout: vi.fn(),
  writeResult: vi.fn(),
}))

const { writeResult } = await import('../../src/utils/stdout-guard.js')
const { commands } = await import('../../src/commands/index.js')
const { descriptors, visibleParams } = await import('../../src/surface/descriptors.js')
const { clearConfigCache } = await import('../../src/config/detector.js')
const { runOperation } = await import('../fixtures/surface.js')

/**
 * The name each operation's report file carries, and the arguments needed to
 * get a result out of it. Written by hand on purpose: these paths are archived
 * by pipelines, so a change here has to be a decision rather than a rename
 * riding along with something else.
 */
const REPORTS: Record<string, { tool: string; args?: Record<string, unknown> }> = {
  'missing': { tool: 'get_missing_translations' },
  'status': { tool: 'get_translation_status' },
  'search': { tool: 'search_translations', args: { query: 'greeting' } },
  'check': { tool: 'find_undefined_keys' },
  'orphans': { tool: 'find_orphan_keys' },
  'find-duplicates': { tool: 'find_duplicate_keys' },
}

const reporting = descriptors.filter(descriptor => descriptor.report !== undefined)

let projectDir: string
let configuredDir: string

/** A project small enough to scan in milliseconds and complete enough to report on. */
async function seedProject(prefix: string, projectConfig: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(dir, 'locales'), { recursive: true })
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({
    defaultLocale: 'en',
    localeDirs: ['locales'],
    locales: ['en', 'de'],
    ...projectConfig,
  }))
  // Keys are namespaced because the scanner only treats dotted, key-shaped
  // candidates as references.
  await writeFile(join(dir, 'locales/en.json'), JSON.stringify({
    common: { greeting: 'Hello', farewell: 'Goodbye' },
  }))
  // de is missing common.farewell, so `missing` and `status` have something to say.
  await writeFile(join(dir, 'locales/de.json'), JSON.stringify({ common: { greeting: 'Hallo' } }))
  // common.farewell is referenced nowhere, so `orphans` has something to say.
  await writeFile(join(dir, 'src/app.ts'), `export const label = t('common.greeting')\n`)
  return dir
}

/** Run a command the way the binary does, and parse what it wrote to stdout. */
async function runCommand(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  vi.mocked(writeResult).mockClear()
  const command = await commands[name]?.load() as unknown as {
    run: (ctx: { args: Record<string, unknown> }) => Promise<void>
  }
  await command.run({ args: { json: true, ...args } })
  const written = vi.mocked(writeResult).mock.calls.at(-1)?.[0]
  return JSON.parse(String(written)) as Record<string, unknown>
}

beforeAll(async () => {
  projectDir = await seedProject('i18n-report-', {})
  configuredDir = await seedProject('i18n-report-configured-', { reportOutput: true })
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
  await rm(configuredDir, { recursive: true, force: true })
})

const savedExitCode = process.exitCode

afterEach(() => {
  process.exitCode = savedExitCode
  clearConfigCache()
})

describe('every operation that declares a report', () => {
  it('covers the whole table, so none of the cases below passes vacuously', () => {
    expect(reporting.map(descriptor => descriptor.id).sort())
      .toEqual(Object.keys(REPORTS).sort())
  })

  it.each(reporting
    .filter(descriptor => visibleParams(descriptor, 'cli').includes('outputFile'))
    .map(descriptor => [descriptor.cli?.name ?? '', descriptor.id] as const))(
    '%s writes the full result to outputFile and returns only the summary',
    async (command, id) => {
      const args = { projectDir, ...REPORTS[id]?.args }
      const inline = await runCommand(command, args)
      const outputFile = join(projectDir, `${id}-report.json`)

      const diverted = await runCommand(command, { ...args, outputFile })

      expect(Object.keys(diverted).sort()).toEqual(['reportFile', 'summary'])
      expect(diverted.reportFile).toBe(outputFile)

      const report = JSON.parse(await readFile(outputFile, 'utf-8')) as Record<string, unknown>
      expect(report.tool).toBe(REPORTS[id]?.tool)
      // The whole result is on disk, under the metadata the report wraps it in.
      expect(report).toMatchObject(inline)
    },
  )

  it.each(reporting.map(descriptor => [descriptor.cli?.name ?? '', descriptor.id] as const))(
    '%s diverts to .i18n-reports/<tool>.json when the project configures reportOutput',
    async (command, id) => {
      const diverted = await runCommand(command, { projectDir: configuredDir, ...REPORTS[id]?.args })

      expect(Object.keys(diverted).sort()).toEqual(['reportFile', 'summary'])
      expect(diverted.reportFile).toBe(join(configuredDir, '.i18n-reports', `${REPORTS[id]?.tool}.json`))

      const report = JSON.parse(await readFile(String(diverted.reportFile), 'utf-8')) as Record<string, unknown>
      expect(report.tool).toBe(REPORTS[id]?.tool)
    },
  )

  it.each(reporting.map(descriptor => [descriptor.cli?.name ?? '', descriptor.id] as const))(
    '%s returns the whole result inline when nothing asks for a file',
    async (command, id) => {
      const result = await runCommand(command, { projectDir, ...REPORTS[id]?.args })

      expect(result).not.toHaveProperty('reportFile')
      expect(Object.keys(result).length).toBeGreaterThan(1)
    },
  )
})

describe('the orphans command, whose three questions each have their own report', () => {
  it('writes the usage scan under scan_code_usage', async () => {
    const result = await runCommand('orphans', { projectDir: configuredDir, usages: true })

    expect(result.reportFile).toBe(join(configuredDir, '.i18n-reports', 'scan_code_usage.json'))
  })

  it('writes the removal under remove_orphan_keys', async () => {
    const removalDir = await seedProject('i18n-report-removal-', { reportOutput: true })
    try {
      const result = await runCommand('orphans', { projectDir: removalDir, remove: true })

      expect(result.reportFile).toBe(join(removalDir, '.i18n-reports', 'remove_orphan_keys.json'))
      const report = JSON.parse(await readFile(String(result.reportFile), 'utf-8')) as Record<string, unknown>
      expect(report).toHaveProperty('removed')
    } finally {
      await rm(removalDir, { recursive: true, force: true })
    }
  })
})

describe('report paths that leave the project', () => {
  // Through the surface helper rather than a command: the command factory
  // turns a thrown error into an error result, and what is under test is that
  // the guard still fires at all.
  it('refuses an absolute path outside the project dir', async () => {
    await expect(runOperation('missing', { projectDir, outputFile: join(tmpdir(), 'escape.json') }))
      .rejects.toThrow(/resolves outside the project directory/)
  })

  it('refuses a relative path that escapes the project dir', async () => {
    await expect(runOperation('missing', { projectDir, outputFile: '../escape.json' }))
      .rejects.toThrow(/resolves outside the project directory/)
  })

  it('resolves a relative path against the project dir, not the process cwd', async () => {
    const result = await runOperation<{ reportFile: string }>('missing', {
      projectDir,
      outputFile: '.i18n-reports/missing-rel.json',
    })

    expect(result.reportFile).toBe(join(projectDir, '.i18n-reports', 'missing-rel.json'))
    const report = JSON.parse(await readFile(result.reportFile, 'utf-8')) as Record<string, unknown>
    expect(report.tool).toBe('get_missing_translations')
  })
})

describe('search, whose outputFile only the server offers', () => {
  // The flag was never added to the command; the parameter is hidden on the
  // CLI and reaches the operation only over MCP, which is the path this takes.
  it('writes the matches to the file and returns the match count', async () => {
    const outputFile = join(projectDir, 'search-report.json')

    const result = await runOperation<{ reportFile: string; summary: unknown }>('search', {
      projectDir,
      query: 'greeting',
      outputFile,
    })

    // One row: both locales define common.greeting, and the default result is
    // one row per key.
    expect(result).toEqual({ reportFile: outputFile, summary: { totalMatches: 1 } })
    const report = JSON.parse(await readFile(outputFile, 'utf-8')) as Record<string, unknown>
    expect(report.tool).toBe('search_translations')
    expect(report.matches).toHaveLength(1)
  })

  it('writes the per-locale rows when the caller asks for them', async () => {
    const outputFile = join(projectDir, 'search-locales-report.json')

    const result = await runOperation<{ reportFile: string; summary: unknown }>('search', {
      projectDir,
      query: 'greeting',
      includeLocales: true,
      outputFile,
    })

    expect(result).toEqual({ reportFile: outputFile, summary: { totalMatches: 2 } })
    const report = JSON.parse(await readFile(outputFile, 'utf-8')) as Record<string, unknown>
    expect(report.matches).toHaveLength(2)
  })
})
