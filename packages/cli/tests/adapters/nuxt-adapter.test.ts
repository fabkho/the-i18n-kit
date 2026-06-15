import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NuxtAdapter } from '../../src/adapters/nuxt/index'

describe('NuxtAdapter.detect', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `nuxt-adapter-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns 2 for a directory with nuxt.config.ts containing i18n', async () => {
    writeFileSync(
      join(tempDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ i18n: { defaultLocale: "en" } })',
    )

    const adapter = new NuxtAdapter()
    const confidence = await adapter.detect(tempDir)
    expect(confidence).toBe(2)
  })

  it('returns 0 for an empty directory without nuxt.config or child apps', async () => {
    const adapter = new NuxtAdapter()
    const confidence = await adapter.detect(tempDir)
    expect(confidence).toBe(0)
  })

  it('returns 2 for a monorepo root containing child Nuxt apps with i18n', async () => {
    const childApp = join(tempDir, 'apps', 'web')
    mkdirSync(childApp, { recursive: true })
    writeFileSync(
      join(childApp, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ i18n: { defaultLocale: "en" } })',
    )

    const adapter = new NuxtAdapter()
    const confidence = await adapter.detect(tempDir)
    expect(confidence).toBe(2)
  })

  it('returns 1 for a directory with nuxt.config but no i18n reference', async () => {
    writeFileSync(
      join(tempDir, 'nuxt.config.ts'),
      'export default defineNuxtConfig({ devtools: { enabled: true } })',
    )

    const adapter = new NuxtAdapter()
    const confidence = await adapter.detect(tempDir)
    expect(confidence).toBe(1)
  })

  it('has correct static properties', () => {
    const adapter = new NuxtAdapter()
    expect(adapter.name).toBe('nuxt')
    expect(adapter.label).toBe('Nuxt')
    expect(adapter.localeFileFormat).toBe('json')
  })
})
