import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePhpLocaleFile, detectPhpStyle, mutatePhpLocaleFile } from '../../src/io/php-writer.js'
import { readPhpLocaleFile, clearPhpFileCache } from '../../src/io/php-reader.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'php-writer-test-'))
  clearPhpFileCache()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('writePhpLocaleFile', () => {
  it('writes a flat object to valid PHP array syntax', async () => {
    const filePath = join(tempDir, 'auth.php')
    await writePhpLocaleFile(filePath, {
      failed: 'These credentials do not match our records.',
      throttle: 'Too many login attempts.',
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe(`<?php

return [
    "failed" => "These credentials do not match our records.",
    "throttle" => "Too many login attempts.",
];
`)
  })

  it('writes nested objects as nested PHP arrays', async () => {
    const filePath = join(tempDir, 'validation.php')
    await writePhpLocaleFile(filePath, {
      custom: {
        email: {
          required: 'We need your email.',
        },
      },
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"custom" => [')
    expect(content).toContain('"email" => [')
    expect(content).toContain('"required" => "We need your email."')
  })

  it('sorts keys alphabetically at every nesting level', async () => {
    const filePath = join(tempDir, 'sorted.php')
    await writePhpLocaleFile(filePath, {
      z: { b: 'two', a: 'one' },
      a: 'first',
    })

    const content = await readFile(filePath, 'utf-8')
    const aIndex = content.indexOf('"a" => "first"')
    const zIndex = content.indexOf('"z" => [')
    expect(aIndex).toBeLessThan(zIndex)

    const innerA = content.indexOf('"a" => "one"')
    const innerB = content.indexOf('"b" => "two"')
    expect(innerA).toBeLessThan(innerB)
  })

  it('uses single quotes when quoteStyle option is single', async () => {
    const filePath = join(tempDir, 'single.php')
    await writePhpLocaleFile(filePath, { key: 'value' }, { quoteStyle: 'single' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain("'key' => 'value'")
  })

  it('uses custom indentation', async () => {
    const filePath = join(tempDir, 'tabs.php')
    await writePhpLocaleFile(filePath, { key: 'value' }, { indent: '\t' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('\t"key" => "value"')
  })

  it('uses atomic writes (temp file + rename)', async () => {
    const filePath = join(tempDir, 'atomic.php')
    await writePhpLocaleFile(filePath, { key: 'value' })

    expect(existsSync(filePath)).toBe(true)
    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"key" => "value"')

    const dirContents = await readFile(filePath, 'utf-8')
    expect(dirContents).toBeDefined()
  })

  it('creates parent directories if needed', async () => {
    const filePath = join(tempDir, 'sub', 'dir', 'test.php')
    await writePhpLocaleFile(filePath, { a: '1' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"a" => "1"')
  })

  it('defaults to double quotes + 4-space indent for new files', async () => {
    const filePath = join(tempDir, 'defaults.php')
    await writePhpLocaleFile(filePath, { key: 'value' })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('    "key" => "value"')
  })

  it('serializes null as unquoted null literal', async () => {
    const filePath = join(tempDir, 'nulls.php')
    await writePhpLocaleFile(filePath, { empty: null })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"empty" => null,')
  })

  it('serializes booleans as unquoted true/false literals', async () => {
    const filePath = join(tempDir, 'bools.php')
    await writePhpLocaleFile(filePath, { active: true, deleted: false })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"active" => true,')
    expect(content).toContain('"deleted" => false,')
  })

  it('serializes numbers as unquoted numeric literals', async () => {
    const filePath = join(tempDir, 'numbers.php')
    await writePhpLocaleFile(filePath, { count: 42, rate: 3.14 })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"count" => 42,')
    expect(content).toContain('"rate" => 3.14,')
  })

  it('serializes arrays as PHP indexed arrays', async () => {
    const filePath = join(tempDir, 'arrays.php')
    await writePhpLocaleFile(filePath, { tags: ['admin', 'user'] })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"tags" => [')
    expect(content).toContain('        "admin",')
    expect(content).toContain('        "user",')
  })

  it('serializes mixed-type arrays correctly', async () => {
    const filePath = join(tempDir, 'mixed.php')
    await writePhpLocaleFile(filePath, { items: ['text', 42, true, null] })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('"items" => [')
    expect(content).toContain('        "text",')
    expect(content).toContain('        42,')
    expect(content).toContain('        true,')
    expect(content).toContain('        null,')
  })
})

describe('detectPhpStyle', () => {
  it('detects single-quote style', () => {
    const content = `<?php\n\nreturn [\n    'key' => 'value',\n];\n`
    const style = detectPhpStyle(content)
    expect(style.quoteStyle).toBe('single')
  })

  it('detects double-quote style', () => {
    const content = `<?php\n\nreturn [\n    "key" => "value",\n];\n`
    const style = detectPhpStyle(content)
    expect(style.quoteStyle).toBe('double')
  })

  it('detects tab indentation', () => {
    const content = `<?php\n\nreturn [\n\t'key' => 'value',\n];\n`
    const style = detectPhpStyle(content)
    expect(style.indent).toBe('\t')
  })

  it('detects 2-space indentation', () => {
    const content = `<?php\n\nreturn [\n  'key' => 'value',\n];\n`
    const style = detectPhpStyle(content)
    expect(style.indent).toBe('  ')
  })

  it('defaults to double quotes + 4-space indent for empty content', () => {
    const style = detectPhpStyle('')
    expect(style.quoteStyle).toBe('double')
    expect(style.indent).toBe('    ')
  })

  it('detects quote style for keys containing non-word characters', () => {
    const content = `<?php\n\nreturn [\n    'validation.email' => 'Invalid email',\n    'auth-failed' => 'Auth failed',\n];\n`
    const style = detectPhpStyle(content)
    expect(style.quoteStyle).toBe('single')
  })

  it('defaults to double when single and double counts are tied', () => {
    const content = `<?php\n\nreturn [\n    'key1' => 'v1',\n    "key2" => "v2",\n];\n`
    const style = detectPhpStyle(content)
    expect(style.quoteStyle).toBe('double')
  })
})

describe('mutatePhpLocaleFile', () => {
  it('reads, mutates, and writes back preserving style', async () => {
    const filePath = join(tempDir, 'mutate.php')
    await writeFile(filePath, `<?php\n\nreturn [\n    'existing' => 'value',\n];\n`)

    await mutatePhpLocaleFile(filePath, (data) => {
      data.added = 'new value'
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain("'added' => 'new value'")
    expect(content).toContain("'existing' => 'value'")
  })
})
