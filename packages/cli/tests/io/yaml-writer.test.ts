import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { writeYamlLocaleFile, mutateYamlLocaleFile } from '../../src/io/yaml-writer.js'
import { readYamlLocaleFile, clearYamlFileCache } from '../../src/io/yaml-reader.js'
import { setNestedValue } from '../../src/io/key-operations.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'yaml-writer-test-'))
  clearYamlFileCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('writeYamlLocaleFile', () => {
  it('writes a block mapping with 2-space indentation', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeYamlLocaleFile(filePath, { common: { save: 'Save' } })

    expect(await readFile(filePath, 'utf-8')).toBe('common:\n  save: Save\n')
  })

  it('sorts keys alphabetically by default', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeYamlLocaleFile(filePath, { c: '3', a: '1', b: '2' })

    expect(Object.keys(parse(await readFile(filePath, 'utf-8')))).toEqual(['a', 'b', 'c'])
  })

  it('sorts nested keys', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeYamlLocaleFile(filePath, { z: { b: '1', a: '2' }, a: '3' })

    const parsed = parse(await readFile(filePath, 'utf-8'))
    expect(Object.keys(parsed)).toEqual(['a', 'z'])
    expect(Object.keys(parsed.z)).toEqual(['a', 'b'])
  })

  it('can skip sorting and keep the order given', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeYamlLocaleFile(filePath, { c: '3', a: '1' }, { sortKeys: false })

    expect(Object.keys(parse(await readFile(filePath, 'utf-8')))).toEqual(['c', 'a'])
  })

  it('adds a trailing newline', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeYamlLocaleFile(filePath, { a: '1' })

    expect((await readFile(filePath, 'utf-8')).endsWith('\n')).toBe(true)
  })

  it('never folds a long string across lines', async () => {
    const filePath = join(tempDir, 'en.yaml')
    const long = `This is a long UI string that would be folded by the default line width of eighty columns, ${'and then some. '.repeat(6)}`
    await writeYamlLocaleFile(filePath, { long })

    const content = await readFile(filePath, 'utf-8')
    expect(content.trimEnd().split('\n')).toHaveLength(1)
    expect(parse(content).long).toBe(long)
  })

  it('creates parent directories if needed', async () => {
    const filePath = join(tempDir, 'sub', 'dir', 'en.yaml')
    await writeYamlLocaleFile(filePath, { a: '1' })

    expect(parse(await readFile(filePath, 'utf-8'))).toEqual({ a: '1' })
  })

  it('overwrites an existing file', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'old: true\n')
    await writeYamlLocaleFile(filePath, { fresh: 'yes' })

    expect(parse(await readFile(filePath, 'utf-8'))).toEqual({ fresh: 'yes' })
  })

  it('writes .yml files the same way', async () => {
    const filePath = join(tempDir, 'de.yml')
    await writeYamlLocaleFile(filePath, { greeting: 'Hallo' })

    expect(await readFile(filePath, 'utf-8')).toBe('greeting: Hallo\n')
  })

  it('quotes values YAML would otherwise read back as something else', async () => {
    const filePath = join(tempDir, 'en.yaml')
    const data = { version: '1.0', truthy: 'true', empty: '', colon: 'note: here' }
    await writeYamlLocaleFile(filePath, data)

    expect(parse(await readFile(filePath, 'utf-8'))).toEqual(data)
  })

  it('round-trips placeholders, linked messages and plural forms unchanged', async () => {
    const filePath = join(tempDir, 'en.yaml')
    const data = {
      welcome: 'Welcome, {name}!',
      items: 'no items | one item | {count} items',
      linked: '@:common.actions.save',
      multiline: 'first line\nsecond line',
    }
    await writeYamlLocaleFile(filePath, data)

    expect(await readYamlLocaleFile(filePath)).toEqual(data)
  })
})

describe('mutateYamlLocaleFile', () => {
  it('reads, mutates, and writes back', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'a: "1"\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      data.b = '2'
    })

    expect(parse(await readFile(filePath, 'utf-8'))).toEqual({ a: '1', b: '2' })
  })

  it('preserves existing key order and inserts new keys in sorted position', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'zebra: z\napple: a\nmango: m\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      data.banana = 'b'
    })

    const content = await readFile(filePath, 'utf-8')
    expect(Object.keys(parse(content))).toEqual(['zebra', 'apple', 'banana', 'mango'])
  })

  it('does not re-sort existing nested keys', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'outer:\n  zebra: z\n  apple: a\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      ;((data.outer as Record<string, unknown>)).banana = 'b'
    })

    const parsed = parse(await readFile(filePath, 'utf-8'))
    expect(Object.keys(parsed.outer)).toEqual(['zebra', 'apple', 'banana'])
  })

  it('works with nested mutation via setNestedValue', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'common:\n  actions:\n    save: Save\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      setNestedValue(data, 'common.actions.delete', 'Delete')
    })

    const parsed = parse(await readFile(filePath, 'utf-8'))
    expect(parsed.common.actions).toEqual({ save: 'Save', delete: 'Delete' })
  })

  it('rewrites 4-space indentation to the writer default', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'outer:\n    inner: value\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      ;((data.outer as Record<string, unknown>)).added = 'new'
    })

    expect(await readFile(filePath, 'utf-8')).toBe('outer:\n  added: new\n  inner: value\n')
  })

  // Comment preservation would mean patching the parsed document tree instead
  // of re-serializing values, which every other writer here also does not do.
  it('drops comments from the file it rewrites', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, '# Greetings shown on the landing page\ngreeting: Hello\n')

    await mutateYamlLocaleFile(filePath, (data) => {
      data.farewell = 'Goodbye'
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).not.toContain('#')
    expect(parse(content)).toEqual({ greeting: 'Hello', farewell: 'Goodbye' })
  })
})
