import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeLocaleFile, mutateLocaleFile } from '../../src/io/json-writer.js'
import { setNestedValue } from '../../src/io/key-operations.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'i18n-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('writeLocaleFile', () => {
  it('writes valid JSON with tab indentation by default', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { hello: 'world' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('{\n\t"hello": "world"\n}\n')
  })

  it('writes with custom indentation', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { a: 1 }, { indent: '  ' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('{\n  "a": 1\n}\n')
  })

  it('sorts keys alphabetically by default', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { c: 3, a: 1, b: 2 })

    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(Object.keys(parsed)).toEqual(['a', 'b', 'c'])
  })

  it('sorts nested keys', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { z: { b: 1, a: 2 }, a: 3 })

    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(Object.keys(parsed)).toEqual(['a', 'z'])
    expect(Object.keys(parsed.z)).toEqual(['a', 'b'])
  })

  it('can skip sorting', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { c: 3, a: 1 }, { sortKeys: false })

    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(Object.keys(parsed)).toEqual(['c', 'a'])
  })

  it('adds trailing newline by default', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { a: 1 })

    const content = await readFile(filePath, 'utf-8')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('can skip trailing newline', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeLocaleFile(filePath, { a: 1 }, { trailingNewline: false })

    const content = await readFile(filePath, 'utf-8')
    expect(content.endsWith('\n')).toBe(false)
  })

  it('creates parent directories if needed', async () => {
    const filePath = join(tempDir, 'sub', 'dir', 'test.json')
    await writeLocaleFile(filePath, { a: 1 })

    const content = await readFile(filePath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ a: 1 })
  })

  it('overwrites existing file', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, '{"old": true}')
    await writeLocaleFile(filePath, { new: true })

    const content = await readFile(filePath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ new: true })
  })
})

describe('mutateLocaleFile', () => {
  it('reads, mutates, and writes back', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, '{\n\t"a": 1\n}\n')

    await mutateLocaleFile(filePath, (data) => {
      data.b = 2
    })

    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed).toEqual({ a: 1, b: 2 })
  })

  it('preserves tab indentation from original file', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, '{\n\t"a": 1\n}\n')

    await mutateLocaleFile(filePath, (data) => {
      data.b = 2
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('\t"a"')
  })

  it('preserves space indentation from original file', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, '{\n  "a": 1\n}\n')

    await mutateLocaleFile(filePath, (data) => {
      data.b = 2
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('  "a"')
    expect(content).not.toContain('\t')
  })

  it('works with nested mutation via setNestedValue', async () => {
    const filePath = join(tempDir, 'test.json')
    await writeFile(filePath, '{\n\t"common": {\n\t\t"actions": {\n\t\t\t"save": "Save"\n\t\t}\n\t}\n}\n')

    await mutateLocaleFile(filePath, (data) => {
      setNestedValue(data, 'common.actions.delete', 'Delete')
    })

    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.common.actions.delete).toBe('Delete')
    expect(parsed.common.actions.save).toBe('Save')
  })
})
