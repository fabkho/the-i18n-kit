import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resolve } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { loadTypedConfig, findTypedConfigFile } from '../../src/config/typed-config.js'
import { loadProjectConfig } from '../../src/config/project-config.js'

const root = resolve(import.meta.dirname, '../../.tmp-typed-config')

// A directory per test. Node's ESM loader caches a module by URL for the life
// of the process, so two tests writing different configs to the same path
// would see whichever ran first — which is also why the CLI, a one-shot
// process, gets a fresh read every invocation.
let tmpDir: string
let n = 0
beforeEach(() => {
  tmpDir = resolve(root, `case-${n++}`)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function write(name: string, contents: string, dir = tmpDir) {
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, name), contents, 'utf-8')
}

describe('loadTypedConfig', () => {
  it('returns null when there is no config file — the case that must keep behaving as before', async () => {
    await mkdir(tmpDir, { recursive: true })
    expect(await loadTypedConfig(tmpDir)).toBeNull()
  })

  it('loads a TypeScript config, types and all', async () => {
    await write('i18n-kit.config.ts', `
      interface Extra { note: string }
      const extra: Extra = { note: 'type annotations must survive' }
      export default {
        defaultLocale: 'en',
        protectedLocales: ['de-formal'],
        glossary: { anny: extra.note },
      }
    `)

    const loaded = await loadTypedConfig(tmpDir)
    expect(loaded?.config.defaultLocale).toBe('en')
    expect(loaded?.config.protectedLocales).toEqual(['de-formal'])
    expect(loaded?.config.glossary).toEqual({ anny: 'type annotations must survive' })
    expect(loaded?.path).toBe(resolve(tmpDir, 'i18n-kit.config.ts'))
  })

  it('resolves defineI18nKitConfig without the package being installed', async () => {
    // What a project written against the docs actually contains. jiti resolves
    // the import to the running CLI, so an npx invocation works too.
    await write('i18n-kit.config.ts', `
      import { defineI18nKitConfig } from 'the-i18n-cli/config'
      export default defineI18nKitConfig({ defaultLocale: 'fr' })
    `)

    const loaded = await loadTypedConfig(tmpDir)
    expect(loaded?.config.defaultLocale).toBe('fr')
  })

  it('accepts a plain .js config', async () => {
    await write('i18n-kit.config.js', `export default { defaultLocale: 'it' }`)
    expect((await loadTypedConfig(tmpDir))?.config.defaultLocale).toBe('it')
  })

  it('rejects an unknown key rather than ignoring it', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocals: ['de'] }`)
    await expect(loadTypedConfig(tmpDir)).rejects.toThrow(/protectedLocals/)
  })

  it('rejects a value the schema disallows', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocales: [''] }`)
    await expect(loadTypedConfig(tmpDir)).rejects.toThrow(/protectedLocales/)
  })

  it('fails loudly when the config throws, naming the file', async () => {
    // Deliberately not the framework-config rule of warn-and-fall-back: this
    // file exists only for the kit, so ignoring it means silently applying
    // none of the policy someone can see in their repository.
    await write('i18n-kit.config.ts', `throw new Error('boom')`)
    await expect(loadTypedConfig(tmpDir)).rejects.toThrow(/i18n-kit\.config\.ts.*boom/s)
  })

  it('explains a config with no default export', async () => {
    await write('i18n-kit.config.ts', `export const config = { defaultLocale: 'en' }`)
    await expect(loadTypedConfig(tmpDir)).rejects.toThrow(/default export/)
  })

  it('explains a config that exports the function instead of calling it', async () => {
    await write('i18n-kit.config.ts', `export default function config() { return {} }`)
    await expect(loadTypedConfig(tmpDir)).rejects.toThrow(/do not pass it/)
  })
})

describe('findTypedConfigFile', () => {
  it('walks up to a parent directory, as .i18n-mcp.json does', async () => {
    const child = resolve(tmpDir, 'apps/admin')
    await mkdir(child, { recursive: true })
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)

    expect(findTypedConfigFile(child)).toBe(resolve(tmpDir, 'i18n-kit.config.ts'))
  })

  it('stops at the nearest one, so an app config shadows the root', async () => {
    const child = resolve(tmpDir, 'apps/admin')
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'de' }`, child)

    expect(findTypedConfigFile(child)).toBe(resolve(child, 'i18n-kit.config.ts'))
  })

  it('prefers .ts when a directory has several', async () => {
    await write('i18n-kit.config.js', `export default { defaultLocale: 'js' }`)
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'ts' }`)

    expect(findTypedConfigFile(tmpDir)).toBe(resolve(tmpDir, 'i18n-kit.config.ts'))
  })
})

describe('loadProjectConfig with both config formats', () => {
  it('merges disjoint keys from the two files', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocales: ['de-formal'] }`)
    await write('.i18n-mcp.json', JSON.stringify({ context: 'a booking product' }))

    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({ context: 'a booking product', protectedLocales: ['de-formal'] })
  })

  it('refuses a key declared in both, naming the key and both files', async () => {
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('.i18n-mcp.json', JSON.stringify({ defaultLocale: 'de' }))

    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/defaultLocale/)
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/i18n-kit\.config\.ts/)
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/\.i18n-mcp\.json/)
  })

  it('does not count the JSON-only $schema as a conflict', async () => {
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('.i18n-mcp.json', JSON.stringify({ $schema: './schema.json', context: 'x' }))

    const config = await loadProjectConfig(tmpDir)
    expect(config?.defaultLocale).toBe('en')
  })

  it('returns the JSON config unchanged when there is no typed config', async () => {
    await write('.i18n-mcp.json', JSON.stringify({ defaultLocale: 'de', protectedLocales: ['en'] }))

    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({ defaultLocale: 'de', protectedLocales: ['en'] })
  })

  it('returns null when neither file exists', async () => {
    await mkdir(resolve(tmpDir, 'nested'), { recursive: true })
    expect(await loadProjectConfig(resolve(tmpDir, 'nested'))).toBeNull()
  })
})
