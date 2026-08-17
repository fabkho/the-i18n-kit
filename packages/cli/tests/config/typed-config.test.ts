import { describe, it, expect } from 'vitest'
import { relative as relativePath, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { loadTypedConfig, findTypedConfigFile } from '../../src/config/typed-config.js'
import { loadProjectConfig } from '../../src/config/project-config.js'
import { tmpProject } from './tmp-project.js'

const project = tmpProject('typed-config')
const write = (name: string, contents: string, into?: string) => project.write(name, contents, into)

describe('loadTypedConfig', () => {
  it('returns null when there is no config file — the case that must keep behaving as before', async () => {
    await project.empty()
    expect(await loadTypedConfig(project.dir)).toBeNull()
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

    const loaded = await loadTypedConfig(project.dir)
    expect(loaded?.config.defaultLocale).toBe('en')
    expect(loaded?.config.protectedLocales).toEqual(['de-formal'])
    expect(loaded?.config.glossary).toEqual({ anny: 'type annotations must survive' })
    expect(loaded?.path).toBe(resolve(project.dir, 'i18n-kit.config.ts'))
  })

  // What a project written against the docs actually contains. jiti resolves
  // the import to the running CLI, so an npx invocation works too. Both
  // spellings publish the same code, and the rescue path is worth nothing if
  // it covers a name the docs no longer recommend.
  it.each([
    ['@the-i18n-kit/cli/config', 'fr'],
    ['the-i18n-cli/config', 'it'],
  ])('resolves defineI18nKitConfig from %s without the package being installed', async (specifier, locale) => {
    await write('i18n-kit.config.ts', `
      import { defineI18nKitConfig } from '${specifier}'
      export default defineI18nKitConfig({ defaultLocale: '${locale}' })
    `)

    const loaded = await loadTypedConfig(project.dir)
    expect(loaded?.config.defaultLocale).toBe(locale)
  })

  it('names the current package when telling you what to wrap the config in', async () => {
    await write('i18n-kit.config.ts', `export default 'nope'`)

    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/@the-i18n-kit\/cli\/config/)
  })

  it('accepts a plain .js config', async () => {
    await write('i18n-kit.config.js', `export default { defaultLocale: 'it' }`)
    expect((await loadTypedConfig(project.dir))?.config.defaultLocale).toBe('it')
  })

  it('rejects an unknown key rather than ignoring it', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocals: ['de'] }`)
    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/protectedLocals/)
  })

  it('rejects a value the schema disallows', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocales: [''] }`)
    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/protectedLocales/)
  })

  it('fails loudly when the config throws, naming the file', async () => {
    // Deliberately not the framework-config rule of warn-and-fall-back: this
    // file exists only for the kit, so ignoring it means silently applying
    // none of the policy someone can see in their repository.
    await write('i18n-kit.config.ts', `throw new Error('boom')`)
    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/i18n-kit\.config\.ts.*boom/s)
  })

  it('explains a config with no default export', async () => {
    await write('i18n-kit.config.ts', `export const config = { defaultLocale: 'en' }`)
    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/default export/)
  })

  it('explains a config that exports the function instead of calling it', async () => {
    await write('i18n-kit.config.ts', `export default function config() { return {} }`)
    await expect(loadTypedConfig(project.dir)).rejects.toThrow(/do not pass it/)
  })
})

describe('findTypedConfigFile', () => {
  it('walks up to a parent directory, as .i18n-mcp.json does', async () => {
    const child = resolve(project.dir, 'apps/admin')
    await mkdir(child, { recursive: true })
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)

    expect(findTypedConfigFile(child)).toBe(resolve(project.dir, 'i18n-kit.config.ts'))
  })

  it('stops at the nearest one, so an app config shadows the root', async () => {
    const child = resolve(project.dir, 'apps/admin')
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'de' }`, child)

    expect(findTypedConfigFile(child)).toBe(resolve(child, 'i18n-kit.config.ts'))
  })

  it('resolves a relative start directory to an absolute config path', async () => {
    // jiti reads a relative path as a bare module specifier, so a relative
    // --projectDir used to make loading a typed config fail outright.
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    const relative = relativePath(process.cwd(), project.dir)

    expect(findTypedConfigFile(relative)).toBe(resolve(project.dir, 'i18n-kit.config.ts'))
    expect((await loadTypedConfig(relative))?.config.defaultLocale).toBe('en')
  })

  it('finds a .cts config, the CommonJS TypeScript spelling', async () => {
    await write('i18n-kit.config.cts', `module.exports = { defaultLocale: 'pt' }`)

    expect(findTypedConfigFile(project.dir)).toBe(resolve(project.dir, 'i18n-kit.config.cts'))
    expect((await loadTypedConfig(project.dir))?.config.defaultLocale).toBe('pt')
  })

  it('warns about a deprecated key rather than passing it through', async () => {
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en', samplingPreferences: { model: 'x' } }`)

    const loaded = await loadTypedConfig(project.dir)
    expect(loaded?.config).toEqual({ defaultLocale: 'en' })
  })

  it('prefers .ts when a directory has several', async () => {
    await write('i18n-kit.config.js', `export default { defaultLocale: 'js' }`)
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'ts' }`)

    expect(findTypedConfigFile(project.dir)).toBe(resolve(project.dir, 'i18n-kit.config.ts'))
  })
})

describe('loadProjectConfig with both config formats', () => {
  it('merges disjoint keys from the two files', async () => {
    await write('i18n-kit.config.ts', `export default { protectedLocales: ['de-formal'] }`)
    await write('.i18n-mcp.json', JSON.stringify({ context: 'a booking product' }))

    const config = await loadProjectConfig(project.dir)
    expect(config).toEqual({ context: 'a booking product', protectedLocales: ['de-formal'] })
  })

  it('refuses a key declared in both, naming the key and both files', async () => {
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('.i18n-mcp.json', JSON.stringify({ defaultLocale: 'de' }))

    await expect(loadProjectConfig(project.dir)).rejects.toThrow(/defaultLocale/)
    await expect(loadProjectConfig(project.dir)).rejects.toThrow(/i18n-kit\.config\.ts/)
    await expect(loadProjectConfig(project.dir)).rejects.toThrow(/\.i18n-mcp\.json/)
  })

  it('does not count the JSON-only $schema as a conflict', async () => {
    await write('i18n-kit.config.ts', `export default { defaultLocale: 'en' }`)
    await write('.i18n-mcp.json', JSON.stringify({ $schema: './schema.json', context: 'x' }))

    const config = await loadProjectConfig(project.dir)
    expect(config?.defaultLocale).toBe('en')
  })

  it('returns the JSON config unchanged when there is no typed config', async () => {
    await write('.i18n-mcp.json', JSON.stringify({ defaultLocale: 'de', protectedLocales: ['en'] }))

    const config = await loadProjectConfig(project.dir)
    expect(config).toEqual({ defaultLocale: 'de', protectedLocales: ['en'] })
  })

  it('returns null when neither file exists', async () => {
    await mkdir(resolve(project.dir, 'nested'), { recursive: true })
    expect(await loadProjectConfig(resolve(project.dir, 'nested'))).toBeNull()
  })
})
