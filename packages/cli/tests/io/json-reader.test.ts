import { describe, it, expect } from 'vitest'
import { detectIndentation } from '../../src/io/json-reader.js'

describe('detectIndentation', () => {
  it.each([
    ['tab', '{\n\t"key": "value"\n}', '\t'],
    ['2-space', '{\n  "key": "value"\n}', '  '],
    ['4-space', '{\n    "key": "value"\n}', '    '],
  ])('detects %s indentation', (_label, content, expected) => {
    expect(detectIndentation(content)).toBe(expected)
  })

  it('defaults to tab for minified or empty JSON', () => {
    expect(detectIndentation('{"key":"value"}')).toBe('\t')
    expect(detectIndentation('')).toBe('\t')
    expect(detectIndentation('{}')).toBe('\t')
  })
})
