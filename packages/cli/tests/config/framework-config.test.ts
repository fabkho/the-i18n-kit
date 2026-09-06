import { describe, it, expect } from 'vitest'
import { relative as relativePath } from 'node:path'
import { readNextI18n } from '../../src/config/framework/next.js'
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

  it('calls a config exported as a function, as Next.js does', async () => {
    await write('next.config.js', `
      export default (phase, { defaultConfig }) => ({
        ...defaultConfig,
        i18n: { locales: ['en', 'da'], defaultLocale: 'da' },
      })
    `)

    expect((await readNextI18n(project.dir))?.defaultLocale).toBe('da')
  })

  it('awaits an async config function', async () => {
    await write('next.config.js', `
      export default async () => ({ i18n: { locales: ['en', 'fi'], defaultLocale: 'fi' } })
    `)

    expect((await readNextI18n(project.dir))?.defaultLocale).toBe('fi')
  })

  it('warns and yields nothing when the config function throws', async () => {
    await write('next.config.js', `export default () => { throw new Error('needs env') }`)
    await expect(readNextI18n(project.dir)).resolves.toBeNull()
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
