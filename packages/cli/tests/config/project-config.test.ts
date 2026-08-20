import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { writeFile, unlink, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { loadProjectConfig, findConfigFile } from '../../src/config/project-config.js'

const playgroundDir = resolve(import.meta.dirname, '../fixtures/nuxt-project')
const tmpDir = resolve(import.meta.dirname, '../../.tmp-test')
const traversalDir = resolve(import.meta.dirname, '../../.tmp-traversal')

describe('loadProjectConfig', () => {
  // Test 1: loads config from playground (we just created the file above)
  it('loads .i18n-mcp.json from fixture', async () => {
    const config = await loadProjectConfig(playgroundDir)
    expect(config).not.toBeNull()
    expect(config!.context).toContain('test fixture')
    expect(config!.layerRules).toHaveLength(2)
    expect(config!.glossary).toBeDefined()
    expect(config!.glossary!['Buchung']).toContain('Booking')
    expect(config!.translationPrompt).toBeDefined()
    expect(config!.localeNotes).toBeDefined()
    expect(config!.examples).toHaveLength(1)
  })

  // Test 2: returns null when no config file exists
  it('returns null when .i18n-mcp.json does not exist', async () => {
    const config = await loadProjectConfig('/tmp')
    expect(config).toBeNull()
  })

  // Test 3: handles minimal config (empty object)
  it('handles minimal config (empty object)', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, '{}', 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.context).toBeUndefined()
      expect(config!.layerRules).toBeUndefined()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Deprecation shim: samplingPreferences must keep validating (strict schema)
  it('accepts deprecated samplingPreferences with a warning and strips it', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        context: 'shim test',
        samplingPreferences: { hints: ['flash'], costPriority: 0.8 },
      }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.context).toBe('shim test')
      expect('samplingPreferences' in config!).toBe(false)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Test 4: throws on invalid JSON
  it('throws on invalid JSON', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, 'not valid json {{{', 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Test 5: throws when root is not an object (e.g., array)
  it('throws when config root is not an object', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, '[]', 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Test 6: throws when context is not a string
  it('throws when context is not a string', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ context: 123 }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Test 7: throws when layerRules items are malformed
  it('throws when layerRules items are missing required fields', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ layerRules: [{ layer: 'root' }] }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // Test 8: config with only some fields is valid
  it('accepts config with only some fields', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ glossary: { hello: 'world' } }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.glossary).toEqual({ hello: 'world' })
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts valid orphanScan config', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        orphanScan: {
          root: {
            ignorePatterns: ['common.datetime.**']
          },
          'app-admin': {
            ignorePatterns: ['admin.legacy.*']
          }
        }
      }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.orphanScan).toBeDefined()
      expect(config!.orphanScan!.root.ignorePatterns).toEqual(['common.datetime.**'])
      expect(config!.orphanScan!['app-admin'].ignorePatterns).toEqual(['admin.legacy.*'])
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when orphanScan is not an object', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ orphanScan: 'invalid' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/orphanScan/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts orphanScan entry with only ignorePatterns', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ orphanScan: { root: { ignorePatterns: ['common.**'] } } }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config?.orphanScan?.root?.ignorePatterns).toEqual(['common.**'])
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts orphanScan entry with empty object', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ orphanScan: { root: {} } }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config?.orphanScan?.root).toEqual({})
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when orphanScan layer entry is not an object', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ orphanScan: { root: 'invalid' } }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/orphanScan/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts valid orphanScan config with ignorePatterns', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        orphanScan: {
          root: {
            ignorePatterns: ['common.datetime.**', 'pages.*.title']
          }
        }
      }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.orphanScan!.root.ignorePatterns).toEqual(['common.datetime.**', 'pages.*.title'])
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts reportOutput as a string', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: 'reports' }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.reportOutput).toBe('reports')
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts providerBaseUrl as a string', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ providerBaseUrl: 'https://gateway.example/v1' }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config!.providerBaseUrl).toBe('https://gateway.example/v1')
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // A blank flag or env var is normalised to "unset" because shells produce
  // those by accident. A blank in the config file cannot, so it is rejected
  // here rather than silently ignored — matching every other string field.
  it('rejects a blank providerBaseUrl instead of treating it as unset', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ providerBaseUrl: '' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/providerBaseUrl/)

      await writeFile(configPath, JSON.stringify({ providerBaseUrl: '   ' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/providerBaseUrl/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  // The prompt builder renders `- ${ex.key}: …` unconditionally, so an entry
  // without a key reached the provider as the literal word "undefined" —
  // offered to the model as a translation key to imitate (#367).
  it('rejects an examples entry with no key, naming the field', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        examples: [{ de: 'Buchung', 'en-us': 'Booking' }],
      }), 'utf-8')

      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/key/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('keeps note optional and accepts any locale code alongside the key', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        examples: [
          { key: 'common.actions.save', de: 'Speichern', 'en-us': 'Save' },
          { key: 'common.terms.booking', de: 'Buchung', note: 'never "Reservierung"' },
        ],
      }), 'utf-8')

      const config = await loadProjectConfig(tmpDir)

      expect(config!.examples).toHaveLength(2)
      expect(config!.examples![0]!['en-us']).toBe('Save')
      expect(config!.examples![1]!.note).toBe('never "Reservierung"')
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts orphanScan without ignorePatterns (optional field)', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        orphanScan: { root: {} }
      }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config!.orphanScan!.root.ignorePatterns).toBeUndefined()
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts reportOutput as true', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: true }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.reportOutput).toBe(true)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when ignorePatterns is not an array', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        orphanScan: { root: { ignorePatterns: 'not-an-array' } }
      }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/orphanScan|ignorePatterns/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when reportOutput is false', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: false }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/reportOutput/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when ignorePatterns contains non-strings', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        orphanScan: { root: { ignorePatterns: ['valid.*', 123] } }
      }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/orphanScan|ignorePatterns/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when reportOutput is a number', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: 42 }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/reportOutput/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when reportOutput is an empty string', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: '' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/reportOutput/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('accepts protectedLocales as an array of locale refs', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({
        protectedLocales: ['en-US', 'en-GB', 'de-DE-formal.json'],
      }), 'utf-8')
      const config = await loadProjectConfig(tmpDir)
      expect(config).not.toBeNull()
      expect(config!.protectedLocales).toEqual(['en-US', 'en-GB', 'de-DE-formal.json'])
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when protectedLocales is not an array', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ protectedLocales: 'en-US' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/protectedLocales/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when protectedLocales contains empty or whitespace-only entries', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ protectedLocales: ['en-US', '  '] }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/protectedLocales/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })

  it('throws when reportOutput is whitespace-only', async () => {
    await mkdir(tmpDir, { recursive: true })
    const configPath = resolve(tmpDir, '.i18n-mcp.json')
    try {
      await writeFile(configPath, JSON.stringify({ reportOutput: '   ' }), 'utf-8')
      await expect(loadProjectConfig(tmpDir)).rejects.toThrow(/reportOutput/)
    } finally {
      if (existsSync(configPath)) await unlink(configPath)
    }
  })
})

describe('parent directory traversal', () => {
  afterEach(async () => {
    if (existsSync(traversalDir)) {
      await rm(traversalDir, { recursive: true })
    }
  })

  it('finds config in parent directory when projectDir is a subdirectory', async () => {
    const childDir = resolve(traversalDir, 'apps/admin')
    await mkdir(childDir, { recursive: true })
    await writeFile(
      resolve(traversalDir, '.i18n-mcp.json'),
      JSON.stringify({ context: 'from-parent' }),
      'utf-8',
    )

    const config = await loadProjectConfig(childDir)
    expect(config).not.toBeNull()
    expect(config!.context).toBe('from-parent')
  })

  it('finds config in grandparent directory', async () => {
    const deepChild = resolve(traversalDir, 'apps/admin/layers/dashboard')
    await mkdir(deepChild, { recursive: true })
    await writeFile(
      resolve(traversalDir, '.i18n-mcp.json'),
      JSON.stringify({ context: 'from-grandparent' }),
      'utf-8',
    )

    const config = await loadProjectConfig(deepChild)
    expect(config).not.toBeNull()
    expect(config!.context).toBe('from-grandparent')
  })

  it('nearest config wins over higher ancestor', async () => {
    const childDir = resolve(traversalDir, 'apps/admin')
    await mkdir(childDir, { recursive: true })

    await writeFile(
      resolve(traversalDir, '.i18n-mcp.json'),
      JSON.stringify({ context: 'root-config' }),
      'utf-8',
    )
    await writeFile(
      resolve(traversalDir, 'apps', '.i18n-mcp.json'),
      JSON.stringify({ context: 'apps-config' }),
      'utf-8',
    )

    const config = await loadProjectConfig(childDir)
    expect(config).not.toBeNull()
    expect(config!.context).toBe('apps-config')
  })

  it('still loads config from exact projectDir (no regression)', async () => {
    await mkdir(traversalDir, { recursive: true })
    await writeFile(
      resolve(traversalDir, '.i18n-mcp.json'),
      JSON.stringify({ context: 'exact-dir' }),
      'utf-8',
    )

    const config = await loadProjectConfig(traversalDir)
    expect(config).not.toBeNull()
    expect(config!.context).toBe('exact-dir')
  })

  it('returns null when no config exists in any ancestor', async () => {
    const deepDir = resolve(traversalDir, 'a/b/c')
    await mkdir(deepDir, { recursive: true })

    const config = await loadProjectConfig(deepDir)
    expect(config).toBeNull()
  })
})

describe('findConfigFile', () => {
  afterEach(async () => {
    if (existsSync(traversalDir)) {
      await rm(traversalDir, { recursive: true })
    }
  })

  it('returns path when config exists in startDir', async () => {
    await mkdir(traversalDir, { recursive: true })
    const configPath = resolve(traversalDir, '.i18n-mcp.json')
    await writeFile(configPath, '{}', 'utf-8')

    expect(findConfigFile(traversalDir)).toBe(configPath)
  })

  it('returns path from parent when not in startDir', async () => {
    const childDir = resolve(traversalDir, 'sub')
    await mkdir(childDir, { recursive: true })
    const configPath = resolve(traversalDir, '.i18n-mcp.json')
    await writeFile(configPath, '{}', 'utf-8')

    expect(findConfigFile(childDir)).toBe(configPath)
  })

  it('returns null when no config exists', async () => {
    const deepDir = resolve(traversalDir, 'x/y/z')
    await mkdir(deepDir, { recursive: true })

    expect(findConfigFile(deepDir)).toBeNull()
  })
})
