import { describe, it, expect } from 'vitest'
import { relative as relativePath, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { readNextI18n } from '../../src/config/framework/next.js'
import { readVueI18nLocaleDirs } from '../../src/config/framework/vue.js'
import { tmpProject } from './tmp-project.js'

const project = tmpProject('framework-config')
const write = (name: string, contents: string) => project.write(name, contents)

describe('readNextI18n', () => {
  it('returns null when the project declares nothing', async () => {
    await project.empty()
    expect(await readNextI18n(project.dir)).toBeNull()
  })

  it('reads next-intl routing, defineRouting being identity over its argument', async () => {
    await write('src/i18n/routing.ts', `
      const defineRouting = (c: unknown) => c
      export const routing = defineRouting({ locales: ['en', 'de'], defaultLocale: 'en' })
    `)

    const found = await readNextI18n(project.dir)
    expect(found?.defaultLocale).toBe('en')
    expect(found?.locales).toEqual(['en', 'de'])
  })

  it('reads a routing file that uses a default export', async () => {
    await write('src/i18n/routing.ts', `export default { locales: ['fr'], defaultLocale: 'fr' }`)
    expect((await readNextI18n(project.dir))?.defaultLocale).toBe('fr')
  })

  it("reads next-translate's i18n.js", async () => {
    await write('i18n.js', `
      module.exports = { locales: ['en', 'pl'], defaultLocale: 'pl', pages: { '*': ['common'] } }
    `)

    const found = await readNextI18n(project.dir)
    expect(found?.defaultLocale).toBe('pl')
    expect(found?.locales).toEqual(['en', 'pl'])
  })

  it("reads the Pages Router's i18n block from next.config", async () => {
    await write('next.config.js', `
      export default { reactStrictMode: true, i18n: { locales: ['en', 'nl'], defaultLocale: 'nl' } }
    `)

    expect((await readNextI18n(project.dir))?.defaultLocale).toBe('nl')
  })

  it('prefers the routing file over next.config, being the more specific statement', async () => {
    await write('src/i18n/routing.ts', `export default { locales: ['en'], defaultLocale: 'en' }`)
    await write('next.config.js', `export default { i18n: { locales: ['de'], defaultLocale: 'de' } }`)

    expect((await readNextI18n(project.dir))?.defaultLocale).toBe('en')
  })

  it('warns and yields nothing when a config throws — never a failure', async () => {
    // The shape of the real problem: a next.config wrapped in a plugin that
    // is not installed, or that needs env the CLI does not have.
    await write('next.config.js', `
      import withSomething from 'a-plugin-that-is-not-installed'
      export default withSomething({ i18n: { locales: ['de'], defaultLocale: 'de' } })
    `)

    await expect(readNextI18n(project.dir)).resolves.toBeNull()
  })

  it('reads through a relative project directory', async () => {
    await write('next.config.js', `export default { i18n: { locales: ['en', 'sv'], defaultLocale: 'sv' } }`)
    const relative = relativePath(process.cwd(), project.dir)

    expect((await readNextI18n(relative))?.defaultLocale).toBe('sv')
  })

  it('ignores a config that declares no locales at all', async () => {
    await write('next.config.js', `export default { reactStrictMode: true }`)
    expect(await readNextI18n(project.dir)).toBeNull()
  })

  it('ignores locale values of the wrong type rather than trusting them', async () => {
    await write('next.config.js', `export default { i18n: { locales: [1, 2], defaultLocale: 42 } }`)
    expect(await readNextI18n(project.dir)).toBeNull()
  })
})

describe('readVueI18nLocaleDirs', () => {
  it('returns null without a vite config', async () => {
    await project.empty()
    expect(await readVueI18nLocaleDirs(project.dir)).toBeNull()
  })

  it("reads the plugin's include, which the plugin object itself never exposes", async () => {
    await mkdir(resolve(project.dir, 'src/translations'), { recursive: true })
    await write('vite.config.ts', `
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      export default {
        plugins: [VueI18nPlugin({ include: ['./src/translations/**'] })],
      }
    `)

    expect(await readVueI18nLocaleDirs(project.dir)).toEqual([resolve(project.dir, 'src/translations')])
  })

  it('evaluates the function form of defineConfig', async () => {
    await mkdir(resolve(project.dir, 'locales'), { recursive: true })
    await write('vite.config.ts', `
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      export default ({ mode }: { mode: string }) => ({
        plugins: [VueI18nPlugin({ include: ['./locales/**/*.json'] })],
        mode,
      })
    `)

    expect(await readVueI18nLocaleDirs(project.dir)).toEqual([resolve(project.dir, 'locales')])
  })

  it('resolves an absolute include, as the plugin docs write it', async () => {
    await mkdir(resolve(project.dir, 'src/i18n/messages'), { recursive: true })
    await write('vite.config.ts', `
      import { resolve, dirname } from 'node:path'
      import { fileURLToPath } from 'node:url'
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      const here = dirname(fileURLToPath(import.meta.url))
      export default {
        plugins: [VueI18nPlugin({ include: [resolve(here, './src/i18n/messages/**')] })],
      }
    `)

    expect(await readVueI18nLocaleDirs(project.dir)).toEqual([resolve(project.dir, 'src/i18n/messages')])
  })

  it('ignores an include naming a directory that does not exist', async () => {
    await write('vite.config.ts', `
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      export default { plugins: [VueI18nPlugin({ include: ['./nowhere/**'] })] }
    `)

    expect(await readVueI18nLocaleDirs(project.dir)).toBeNull()
  })

  it('returns null when the config never uses the plugin', async () => {
    await write('vite.config.ts', `export default { plugins: [] }`)
    expect(await readVueI18nLocaleDirs(project.dir)).toBeNull()
  })

  it('warns and yields nothing when the vite config throws', async () => {
    await write('vite.config.ts', `
      import somethingMissing from 'a-vite-plugin-that-is-not-installed'
      export default { plugins: [somethingMissing()] }
    `)

    await expect(readVueI18nLocaleDirs(project.dir)).resolves.toBeNull()
  })

  it('gives the same answer when the same project is read twice', async () => {
    // Node executes an ES module once per process, so the second read imports
    // the cache, calls no plugin and records nothing. Without remembering the
    // answer that silently became "this project declares no locale dirs".
    await mkdir(resolve(project.dir, 'src/translations'), { recursive: true })
    await write('vite.config.ts', `
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      export default { plugins: [VueI18nPlugin({ include: ['./src/translations/**'] })] }
    `)

    const first = await readVueI18nLocaleDirs(project.dir)
    const second = await readVueI18nLocaleDirs(project.dir)

    expect(first).toEqual([resolve(project.dir, 'src/translations')])
    expect(second).toEqual(first)
  })

  it('does not leak a recorded include into the next project read', async () => {
    await mkdir(resolve(project.dir, 'locales'), { recursive: true })
    await write('vite.config.ts', `
      import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
      export default { plugins: [VueI18nPlugin({ include: ['./locales/**'] })] }
    `)
    expect(await readVueI18nLocaleDirs(project.dir)).not.toBeNull()

    // A second project with a config that never calls the plugin must not
    // inherit the first one's answer through the recording symbol.
    const other = resolve(project.root, 'other-project')
    await mkdir(other, { recursive: true })
    await writeFile(resolve(other, 'vite.config.ts'), `export default { plugins: [] }`, 'utf-8')

    expect(await readVueI18nLocaleDirs(other)).toBeNull()
  })
})
