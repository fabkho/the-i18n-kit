import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { protectedLocalesFrom, readConfigSources } from '../src/project-config'
import { checkProtectedLocales } from '../src/validate'
import type { ArtifactLocale } from '../src/artifact'

const logger = { warn: vi.fn(), error: vi.fn(), success: vi.fn() }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-kit-nuxt-config-'))
  vi.clearAllMocks()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('reading the hand-written config', () => {
  it('finds nothing when the project has neither file', async () => {
    // A project with no config is the case that must keep building as before.
    expect(await readConfigSources(dir, logger)).toEqual([])
  })

  it('reads a TypeScript config as it sits on disk, with no build step', async () => {
    await writeFile(join(dir, 'i18n-kit.config.ts'), `
      const protectedLocales: string[] = ['de-formal']
      export default { protectedLocales }
    `)

    const [source, ...rest] = await readConfigSources(dir, logger)

    expect(rest).toEqual([])
    expect(source?.config.protectedLocales).toEqual(['de-formal'])
  })

  it('reads both files when a project has both', async () => {
    await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({ defaultLocale: 'en' }))
    await writeFile(join(dir, 'i18n-kit.config.ts'), `export default { protectedLocales: ['de'] }`)

    const sources = await readConfigSources(dir, logger)

    expect(sources).toHaveLength(2)
  })

  it('walks up from the app, so a layered repo finds the config at its root', async () => {
    await writeFile(join(dir, 'i18n-kit.config.ts'), `export default { protectedLocales: ['de'] }`)
    const app = join(dir, 'apps/booking')
    await mkdir(app, { recursive: true })

    const [source] = await readConfigSources(app, logger)

    expect(source?.path).toBe(join(dir, 'i18n-kit.config.ts'))
  })

  it('reports a config it cannot read and carries on rather than failing the build', async () => {
    await writeFile(join(dir, '.i18n-mcp.json'), '{ not json')

    expect(await readConfigSources(dir, logger)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('.i18n-mcp.json'))
  })
})

describe('protectedLocales across both files', () => {
  const locales: ArtifactLocale[] = [
    { code: 'de', language: 'de-DE', file: 'de-DE.json' },
    { code: 'de-formal', language: 'de-DE', file: 'de-DE-formal.json' },
  ]

  // The failure #362 was filed for: a protected locale declared in the
  // recommended file was never checked against the locale table, so a typo
  // there protected nothing — silently, which is how de-DE-formal sat in the
  // machine-translation target list for months.
  it('checks a ref declared only in the typed config', async () => {
    await writeFile(join(dir, 'i18n-kit.config.ts'), `export default { protectedLocales: ['de-DE-formal'] }`)

    const sources = await readConfigSources(dir, logger)
    const [diagnostic] = checkProtectedLocales(protectedLocalesFrom(sources), locales)

    expect(diagnostic?.level).toBe('error')
    expect(diagnostic?.message).toContain('"de-DE-formal" matches no locale')
  })

  it('collects the refs from both files', async () => {
    await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({ protectedLocales: ['de'] }))
    await writeFile(join(dir, 'i18n-kit.config.ts'), `export default { protectedLocales: ['de-formal'] }`)

    const refs = protectedLocalesFrom(await readConfigSources(dir, logger))

    expect(refs.sort()).toEqual(['de', 'de-formal'])
  })

  it('has nothing to check when neither file declares any', async () => {
    await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({ defaultLocale: 'en' }))

    expect(protectedLocalesFrom(await readConfigSources(dir, logger))).toEqual([])
  })
})
