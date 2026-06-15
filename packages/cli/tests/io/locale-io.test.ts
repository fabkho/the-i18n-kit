import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocale, writeLocale, mutateLocale } from '../../src/io/locale-io.js'
import { clearFileCache } from '../../src/io/json-reader.js'
import { clearPhpFileCache } from '../../src/io/php-reader.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'locale-io-test-'))
  clearFileCache()
  clearPhpFileCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('readLocale', () => {
  it('dispatches .json to json reader', async () => {
    const filePath = join(tempDir, 'en.json')
    await writeFile(filePath, '{"hello": "world"}')

    const data = await readLocale(filePath)
    expect(data).toEqual({ hello: 'world' })
  })

  it('dispatches .php to php reader', async () => {
    const filePath = join(tempDir, 'en.php')
    await writeFile(filePath, `<?php\nreturn ['hello' => 'world'];\n`)

    const data = await readLocale(filePath)
    expect(data).toEqual({ hello: 'world' })
  })

  it('throws for unsupported extensions', async () => {
    const filePath = join(tempDir, 'en.yaml')
    await writeFile(filePath, 'hello: world')

    await expect(readLocale(filePath)).rejects.toThrow(/Unsupported locale file format/)
  })
})

describe('writeLocale', () => {
  it('dispatches .json to json writer', async () => {
    const filePath = join(tempDir, 'out.json')
    await writeLocale(filePath, { key: 'value' })

    const content = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'))
    expect(JSON.parse(content)).toEqual({ key: 'value' })
  })

  it('dispatches .php to php writer', async () => {
    const filePath = join(tempDir, 'out.php')
    await writeLocale(filePath, { key: 'value' })

    const content = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'))
    expect(content).toContain('"key" => "value"')
  })
})

describe('roundtrip', () => {
  it('read → modify → write → read produces correct data for PHP files', async () => {
    const filePath = join(tempDir, 'roundtrip.php')
    await writeFile(filePath, `<?php

return [
    'greeting' => 'Hello',
    'farewell' => 'Goodbye',
];
`)

    await mutateLocale(filePath, (data) => {
      data.greeting = 'Hi'
      data.added = 'New value'
    })

    clearPhpFileCache()
    const result = await readLocale(filePath)
    expect(result.greeting).toBe('Hi')
    expect(result.farewell).toBe('Goodbye')
    expect(result.added).toBe('New value')
  })

  it('read → modify → write → read produces correct data for JSON files', async () => {
    const filePath = join(tempDir, 'roundtrip.json')
    await writeFile(filePath, '{\n\t"greeting": "Hello",\n\t"farewell": "Goodbye"\n}\n')

    await mutateLocale(filePath, (data) => {
      data.greeting = 'Hi'
      data.added = 'New value'
    })

    clearFileCache()
    const result = await readLocale(filePath)
    expect(result.greeting).toBe('Hi')
    expect(result.farewell).toBe('Goodbye')
    expect(result.added).toBe('New value')
  })
})
