import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  detectConfig,
  listLocaleDirs,
  getMissingTranslations,
  writeTranslations,
  scaffoldLocaleFiles,
  translateMissing,
} from '../../src/core/operations.js'
import { clearConfigCache } from '../../src/config/detector.js'
import { fakeTranslator } from '../fixtures/translate-harness.js'

/**
 * A whole generic project in YAML, driven through the public operations: the
 * registry has to carry the format from detection all the way to the writes.
 */

let projectDir: string
let localesDir: string

async function readYaml(fileName: string): Promise<Record<string, unknown>> {
  return parse(await readFile(join(localesDir, fileName), 'utf-8')) as Record<string, unknown>
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'yaml-project-'))
  localesDir = join(projectDir, 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(projectDir, '.i18n-mcp.json'), JSON.stringify({
    localeDirs: ['locales'],
    defaultLocale: 'en',
    locales: ['en', 'de', 'fr'],
  }, null, 2))
  await writeFile(join(localesDir, 'en.yaml'), `greeting: Hello {name}
actions:
  save: Save
  cancel: Cancel
`)
  await writeFile(join(localesDir, 'de.yaml'), `greeting: Hallo {name}
actions:
  save: Speichern
`)
  clearConfigCache()
})

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true })
  clearConfigCache()
})

describe('a generic project with YAML locale files', () => {
  it('is detected as the yaml format with its locales discovered', async () => {
    const config = await detectConfig(projectDir)

    expect(config.localeFileFormat).toBe('yaml')
    expect(config.locales.map(l => l.code)).toEqual(['en', 'de', 'fr'])
    expect(config.locales.find(l => l.code === 'de')?.file).toBe('de.yaml')
  })

  it('counts the yaml files and reads their top-level keys', async () => {
    const [layer] = await listLocaleDirs(projectDir)

    expect(layer?.fileCount).toBe(2)
    expect(layer?.topLevelKeys?.sort()).toEqual(['actions', 'greeting'])
  })

  it('reports the keys missing from the other locales', async () => {
    const result = await getMissingTranslations({ projectDir })

    expect(result.missing).toEqual({
      de: { default: ['actions.cancel'] },
      fr: { default: ['greeting', 'actions.save', 'actions.cancel'] },
    })
  })

  it('writes translations back as valid yaml, preserving key order', async () => {
    const result = await writeTranslations({
      projectDir,
      layer: 'default',
      translations: { 'actions.cancel': { de: 'Abbrechen' } },
    })

    expect(result.written).toEqual(['actions.cancel'])
    expect(result.filesWritten).toBe(1)
    expect(await readYaml('de.yaml')).toEqual({
      greeting: 'Hallo {name}',
      actions: { save: 'Speichern', cancel: 'Abbrechen' },
    })
    // Existing keys keep their place and the new one lands in sorted position
    // among its siblings — the same rule the JSON writer follows.
    expect(await readFile(join(localesDir, 'de.yaml'), 'utf-8')).toBe(
      'greeting: Hallo {name}\nactions:\n  cancel: Abbrechen\n  save: Speichern\n',
    )
  })

  it('scaffolds a new locale as a .yaml file with an empty structure', async () => {
    const result = await scaffoldLocaleFiles({ projectDir, locales: ['fr'] })

    expect(result.created).toEqual([
      { locale: 'fr', layer: 'default', file: 'locales/fr.yaml', keys: 3 },
    ])
    expect(existsSync(join(localesDir, 'fr.yaml'))).toBe(true)
    expect(await readYaml('fr.yaml')).toEqual({
      actions: { cancel: '', save: '' },
      greeting: '',
    })
  })

  it('translates the missing keys into every target locale', async () => {
    // A locale with no file yet is written by scaffolding, not by translating.
    await scaffoldLocaleFiles({ projectDir, locales: ['fr'] })
    clearConfigCache()

    const result = await translateMissing({
      projectDir,
      layer: 'default',
      translateFn: fakeTranslator((_key, value) => `[t] ${value}`),
    })

    expect(result.summary.totalFailed).toBe(0)
    expect(await readYaml('de.yaml')).toEqual({
      greeting: 'Hallo {name}',
      actions: { save: 'Speichern', cancel: '[t] Cancel' },
    })
    expect(await readYaml('fr.yaml')).toEqual({
      greeting: '[t] Hello {name}',
      actions: { save: '[t] Save', cancel: '[t] Cancel' },
    })
  })

  it('handles a .yml layer the same way', async () => {
    await rm(join(localesDir, 'en.yaml'))
    await rm(join(localesDir, 'de.yaml'))
    await writeFile(join(localesDir, 'en.yml'), 'greeting: Hello\n')
    await writeFile(join(localesDir, 'de.yml'), '{}\n')
    clearConfigCache()

    const config = await detectConfig(projectDir)
    expect(config.localeFileFormat).toBe('yaml')
    expect(config.locales.find(l => l.code === 'de')?.file).toBe('de.yml')

    await writeTranslations({
      projectDir,
      layer: 'default',
      translations: { greeting: { de: 'Hallo' } },
    })

    expect(await readYaml('de.yml')).toEqual({ greeting: 'Hallo' })
  })
})
