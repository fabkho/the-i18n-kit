import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readYamlLocaleFile, clearYamlFileCache } from '../../src/io/yaml-reader.js'
import { FileIOError } from '../../src/utils/errors.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'yaml-reader-test-'))
  clearYamlFileCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('readYamlLocaleFile', () => {
  it('reads a flat mapping into Record<string, unknown>', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'failed: These credentials do not match our records.\nthrottle: Too many login attempts.\n')

    const data = await readYamlLocaleFile(filePath)
    expect(data).toEqual({
      failed: 'These credentials do not match our records.',
      throttle: 'Too many login attempts.',
    })
  })

  it('reads nested mappings into nested objects', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, `common:
  actions:
    save: Save
    cancel: Cancel
greeting: Hello
`)

    const data = await readYamlLocaleFile(filePath)
    expect(data).toEqual({
      common: { actions: { save: 'Save', cancel: 'Cancel' } },
      greeting: 'Hello',
    })
  })

  it('reads a .yml file the same way', async () => {
    const filePath = join(tempDir, 'de.yml')
    await writeFile(filePath, 'greeting: Hallo\n')

    expect(await readYamlLocaleFile(filePath)).toEqual({ greeting: 'Hallo' })
  })

  it('keeps {placeholder}, @:linked and | plural syntax as plain strings', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, `welcome: Welcome, {name}!
items: no items | one item | {count} items
linked: '@:common.actions.save'
`)

    const data = await readYamlLocaleFile(filePath)
    expect(data.welcome).toBe('Welcome, {name}!')
    expect(data.items).toBe('no items | one item | {count} items')
    expect(data.linked).toBe('@:common.actions.save')
  })

  it('preserves the on-disk key order', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'zebra: z\napple: a\nmango: m\n')

    expect(Object.keys(await readYamlLocaleFile(filePath))).toEqual(['zebra', 'apple', 'mango'])
  })

  it('returns cached data when file mtime has not changed', async () => {
    const filePath = join(tempDir, 'cached.yaml')
    await writeFile(filePath, 'a: "1"\n')

    const first = await readYamlLocaleFile(filePath)
    const second = await readYamlLocaleFile(filePath)
    expect(first).toEqual(second)
    expect(first).not.toBe(second) // structuredClone returns different reference
  })

  it('invalidates cache when file mtime changes', async () => {
    const filePath = join(tempDir, 'changing.yaml')
    await writeFile(filePath, 'key: old\n')

    expect((await readYamlLocaleFile(filePath)).key).toBe('old')

    await writeFile(filePath, 'key: new\n')
    const future = new Date(Date.now() + 2000)
    await utimes(filePath, future, future)

    expect((await readYamlLocaleFile(filePath)).key).toBe('new')
  })

  it('throws FileIOError for non-existent file', async () => {
    const filePath = join(tempDir, 'nope.yaml')
    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(FileIOError)
    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/File not found/)
  })

  it('throws FileIOError for malformed YAML', async () => {
    const filePath = join(tempDir, 'bad.yaml')
    await writeFile(filePath, 'a: [1, 2\nb: "unterminated\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(FileIOError)
    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/Failed to read YAML file/)
  })

  it('rejects a document that is not a mapping', async () => {
    const filePath = join(tempDir, 'sequence.yaml')
    await writeFile(filePath, '- apple\n- banana\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(FileIOError)
    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/must contain a mapping/)
  })

  it('rejects a scalar document', async () => {
    const filePath = join(tempDir, 'scalar.yaml')
    await writeFile(filePath, 'just a string\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/must contain a mapping/)
  })

  it('rejects an empty file', async () => {
    const filePath = join(tempDir, 'empty.yaml')
    await writeFile(filePath, '')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/must contain a mapping/)
  })

  it('rejects a multi-document file by name', async () => {
    const filePath = join(tempDir, 'multi.yaml')
    await writeFile(filePath, 'a: 1\n---\nb: 2\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(FileIOError)
    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(/must hold exactly one/)
  })

  it('sets INVALID_YAML on the error code for a non-mapping document', async () => {
    const filePath = join(tempDir, 'sequence.yaml')
    await writeFile(filePath, '- apple\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toMatchObject({ code: 'INVALID_YAML' })
  })

  it('does not cache invalid parsed results', async () => {
    const filePath = join(tempDir, 'no-cache.yaml')
    await writeFile(filePath, '- apple\n- banana\n')

    await expect(readYamlLocaleFile(filePath)).rejects.toThrow(FileIOError)

    await writeFile(filePath, 'key: value\n')
    const future = new Date(Date.now() + 2000)
    await utimes(filePath, future, future)

    expect(await readYamlLocaleFile(filePath)).toEqual({ key: 'value' })
  })
})
