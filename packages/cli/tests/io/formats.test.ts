import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocaleFileFormat } from '../../src/adapters/types.js'
import {
  getFormat,
  formatForFile,
  listFormats,
  registerFormat,
  detectFormatInDir,
} from '../../src/io/formats.js'
import { FileIOError, ConfigError } from '../../src/utils/errors.js'

let tempDir: string

/** A format id the registry has never heard of. */
const unknownId = 'toml' as unknown as LocaleFileFormat

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'formats-test-'))
  for (const format of listFormats()) format.clearCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('formatForFile', () => {
  it.each([
    ['en.json', 'json'],
    ['en.php', 'php-array'],
  ])('resolves %s to the %s format', (fileName, id) => {
    expect(formatForFile(join(tempDir, fileName)).id).toBe(id)
  })

  it('matches the extension case-insensitively', () => {
    expect(formatForFile(join(tempDir, 'en.JSON')).id).toBe('json')
  })

  it('throws a FileIOError naming the extension for an unknown one', () => {
    const filePath = join(tempDir, 'en.toml')
    expect(() => formatForFile(filePath)).toThrow(FileIOError)
    expect(() => formatForFile(filePath)).toThrow(/Unsupported locale file format: \.toml/)
  })

  it('throws for a file with no extension at all', () => {
    expect(() => formatForFile(join(tempDir, 'en'))).toThrow(/Unsupported locale file format/)
  })
})

describe('format dispatch', () => {
  it('reads through the format that owns the extension', async () => {
    await writeFile(join(tempDir, 'en.json'), '{"hello": "world"}')
    await writeFile(join(tempDir, 'en.php'), '<?php\nreturn [\'hello\' => \'world\'];\n')

    for (const fileName of ['en.json', 'en.php']) {
      const filePath = join(tempDir, fileName)
      expect(await formatForFile(filePath).read(filePath)).toEqual({ hello: 'world' })
    }
  })

  it('writes through the format that owns the extension', async () => {
    const jsonPath = join(tempDir, 'out.json')
    const phpPath = join(tempDir, 'out.php')

    await formatForFile(jsonPath).write(jsonPath, { key: 'value' })
    await formatForFile(phpPath).write(phpPath, { key: 'value' })

    expect(await readFile(jsonPath, 'utf-8')).toContain('"key": "value"')
    expect(await readFile(phpPath, 'utf-8')).toContain('"key" => "value"')
  })
})

describe('getFormat', () => {
  it('resolves a format id', () => {
    expect(getFormat('json').extensions).toEqual(['.json'])
    expect(getFormat('php-array').extensions).toEqual(['.php'])
  })

  it('defaults to JSON when the config declares no format', () => {
    expect(getFormat(undefined).id).toBe('json')
  })

  it('throws a ConfigError listing the known formats for an unknown id', () => {
    expect(() => getFormat(unknownId)).toThrow(ConfigError)
    expect(() => getFormat(unknownId)).toThrow(/Known formats: json, php-array/)
  })
})

describe('detectFormatInDir', () => {
  it('detects flat files by extension', async () => {
    await writeFile(join(tempDir, 'en.json'), '{}')
    await writeFile(join(tempDir, 'de.json'), '{}')

    expect(await detectFormatInDir(tempDir)).toBe('json')
  })

  it('detects a directory-per-locale layout', async () => {
    await mkdir(join(tempDir, 'en'), { recursive: true })
    await writeFile(join(tempDir, 'en', 'auth.php'), '<?php return [];')

    expect(await detectFormatInDir(tempDir)).toBe('php-array')
  })

  it('returns null for a directory with nothing recognizable in it', async () => {
    await writeFile(join(tempDir, 'README.md'), '# nothing here')

    expect(await detectFormatInDir(tempDir)).toBeNull()
  })

  it('returns null for a directory that does not exist', async () => {
    expect(await detectFormatInDir(join(tempDir, 'nope'))).toBeNull()
  })

  it('picks the majority format in a mixed directory', async () => {
    await writeFile(join(tempDir, 'en.php'), '<?php return [];')
    await writeFile(join(tempDir, 'de.php'), '<?php return [];')
    await writeFile(join(tempDir, 'fr.json'), '{}')

    expect(await detectFormatInDir(tempDir)).toBe('php-array')
  })
})

// Last: registration is global to the module, so anything added here is
// visible to every test that follows it.
describe('registerFormat', () => {
  it('makes a new extension resolvable without touching the existing ones', () => {
    const before = listFormats().length
    registerFormat({
      ...getFormat('json'),
      id: 'test-only' as unknown as LocaleFileFormat,
      extensions: ['.i18n-test'],
    })

    expect(formatForFile(join(tempDir, 'en.i18n-test')).id).toBe('test-only')
    expect(formatForFile(join(tempDir, 'en.json')).id).toBe('json')
    expect(listFormats()).toHaveLength(before + 1)
  })
})
