/**
 * Vue projects resolved by the generic adapter.
 *
 * There is no Vue adapter: a Vue SPA is a directory of locale files plus
 * `.vue` sources, and both halves are things the generic adapter and the
 * scanner already handle. These are the cases that used to be the Vue
 * adapter's, run against what replaced it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectI18nConfig, clearConfigCache } from '../../src/config/detector.js'
import { initProjectConfig, scanCodeUsage } from '../../src/core/operations.js'
import { loadProjectConfig, CONFIG_FILENAME } from '../../src/config/project-config.js'
import { log } from '../../src/utils/logger.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'i18n-vue-generic-'))
  clearConfigCache()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  clearConfigCache()
})

/** What `create-vue` plus `vue-i18n` leaves on disk, locale directory apart. */
async function createVueProject(localeDir = 'src/locales', locales = ['en', 'de']) {
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'vue-app',
    dependencies: { vue: '^3.5.0', 'vue-i18n': '^11.0.0' },
    devDependencies: { vite: '^7.0.0', '@vitejs/plugin-vue': '^5.0.0' },
  }))
  await writeFile(join(dir, 'vite.config.ts'), `
    import vue from '@vitejs/plugin-vue'
    export default { plugins: [vue()] }
  `)

  await mkdir(join(dir, localeDir), { recursive: true })
  for (const locale of locales) {
    // The source locale is the fullest one, which is how init tells it from
    // the one that merely sorts first.
    await writeFile(join(dir, localeDir, `${locale}.json`), JSON.stringify(
      locale === 'en'
        ? { common: { actions: { save: 'Save', cancel: 'Cancel' } } }
        : { common: { actions: { save: 'Speichern' } } },
    ))
  }

  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/App.vue'), [
    '<script setup lang="ts">',
    "import { useI18n } from 'vue-i18n'",
    'const { t } = useI18n()',
    '</script>',
    '',
    '<template>',
    "  <h1>{{ $t('common.actions.save') }}</h1>",
    "  <p>{{ t('common.actions.save') }}</p>",
    '</template>',
  ].join('\n'))
}

describe('a zero-config Vue project', () => {
  it.each([
    'src/locales',
    'src/i18n/locales',
    'locales',
    'i18n/locales',
    'src/i18n',
  ])('resolves %s without any config file', async (localeDir) => {
    await createVueProject(localeDir)

    const config = await detectI18nConfig(dir)

    expect(config.framework).toBe('generic')
    expect(config.localeDirs.map(d => d.path)).toEqual([join(dir, localeDir)])
    expect(config.locales.map(l => l.code)).toEqual(['de', 'en'])
  })

  // The alphabet is not a decision about which locale is the source, so the
  // one line that settles it has to win over discovery.
  it('takes the default locale from the config file when there is one', async () => {
    await createVueProject()
    await writeFile(join(dir, CONFIG_FILENAME), JSON.stringify({ defaultLocale: 'en' }))

    const config = await detectI18nConfig(dir)

    expect(config.defaultLocale).toBe('en')
    expect(config.fallbackLocale).toEqual({ default: ['en'] })
  })

  it('names the directory in the error when it is an unconventional one', async () => {
    await createVueProject('src/translations')

    await expect(detectI18nConfig(dir)).rejects.toThrow(/localeDirs/)
  })
})

describe('a Vue project that declares its locale directories', () => {
  it('keeps every directory, each as the layer the config names', async () => {
    await createVueProject('src/messages')
    await mkdir(join(dir, 'src/admin/messages'), { recursive: true })
    await writeFile(join(dir, 'src/admin/messages/en.json'), JSON.stringify({ admin: 'Admin' }))
    await writeFile(join(dir, CONFIG_FILENAME), JSON.stringify({
      defaultLocale: 'en',
      localeDirs: [
        { path: 'src/messages', layer: 'app' },
        { path: 'src/admin/messages', layer: 'admin' },
      ],
    }))

    const config = await detectI18nConfig(dir)

    expect(config.localeDirs.map(d => d.path)).toEqual([
      join(dir, 'src/messages'),
      join(dir, 'src/admin/messages'),
    ])
    expect(config.localeDirs.map(d => d.layer)).toEqual(['app', 'admin'])
    expect(config.apps[0]!.layers).toEqual(['app', 'admin'])
  })
})

describe('framework: "vue" in an existing config', () => {
  it('resolves through the generic adapter instead of failing on an unknown name', async () => {
    await createVueProject()
    await writeFile(join(dir, CONFIG_FILENAME), JSON.stringify({ framework: 'vue' }))

    const config = await detectI18nConfig(dir)

    expect(config.framework).toBe('generic')
    expect(config.localeDirs.map(d => d.path)).toEqual([join(dir, 'src/locales')])
  })

  // One line, once. The hint is matched against every registered adapter in
  // turn, so a warning raised while searching is raised once per adapter.
  it('says on stderr what the project has to declare, once', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      await createVueProject()
      await writeFile(join(dir, CONFIG_FILENAME), JSON.stringify({ framework: 'vue' }))

      await detectI18nConfig(dir)

      const retirement = warn.mock.calls
        .map(call => call.join(' '))
        .filter(line => line.includes('vue projects resolve through the generic adapter'))

      expect(retirement).toEqual(['framework: "vue" — vue projects resolve through the generic adapter; declare localeDirs'])
    }
    finally {
      warn.mockRestore()
    }
  })
})

describe('init on a create-vue project', () => {
  it('writes the locale config, and the loader then accepts it', async () => {
    await createVueProject()

    const result = await initProjectConfig({ projectDir: dir })

    expect(result.detected.adapter).toBe('generic')
    expect(result.config.localeDirs).toEqual(['src/locales'])
    expect(result.config.defaultLocale).toBe('en')
    await expect(loadProjectConfig(dir)).resolves.toMatchObject({ localeDirs: ['src/locales'] })
  })

  it('leaves a project the CLI can resolve', async () => {
    await createVueProject()
    await initProjectConfig({ projectDir: dir })
    clearConfigCache()

    const config = await detectI18nConfig(dir)

    expect(config.localeDirs.map(d => d.path)).toEqual([join(dir, 'src/locales')])
  })
})

describe('scanning a Vue project resolved as generic', () => {
  // The pattern set is keyed by locale file format, and JSON means the
  // $t / t / useI18n patterns over .vue, .ts and .js — which is what a Vue
  // project needs whichever adapter resolved it.
  it('finds $t and t calls in a .vue file', async () => {
    await createVueProject()

    const result = await scanCodeUsage({ projectDir: dir })

    expect(Object.keys(result.usages)).toEqual(['common.actions.save'])
    expect(result.usages['common.actions.save']!.map(u => u.file)).toEqual(['src/App.vue', 'src/App.vue'])
    expect(result.usages['common.actions.save']!.map(u => u.callee).sort()).toEqual(['$t', 't'])
  })
})
