import { describe, it, expect } from 'vitest'
import {
  getNestedValue,
  setNestedValue,
  removeNestedValue,
  hasNestedKey,
  getLeafKeys,
  sortKeysDeep,
  renameNestedKey,
} from '../../src/io/key-operations.js'

describe('getNestedValue', () => {
  it('gets a top-level value', () => {
    expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar')
  })

  it('gets a deeply nested value', () => {
    const obj = { a: { b: { c: 'deep' } } }
    expect(getNestedValue(obj, 'a.b.c')).toBe('deep')
  })

  it('returns undefined for missing path', () => {
    expect(getNestedValue({ a: { b: 1 } }, 'a.c')).toBeUndefined()
  })

  it('returns undefined for path through non-object', () => {
    expect(getNestedValue({ a: 'string' }, 'a.b')).toBeUndefined()
  })

  it('returns the whole nested object when path points to one', () => {
    const obj = { a: { b: { c: 1 } } }
    expect(getNestedValue(obj, 'a.b')).toEqual({ c: 1 })
  })
})

describe('setNestedValue', () => {
  it('sets a top-level value', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, 'foo', 'bar')
    expect(obj).toEqual({ foo: 'bar' })
  })

  it('sets a deeply nested value, creating intermediates', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, 'a.b.c', 'deep')
    expect(obj).toEqual({ a: { b: { c: 'deep' } } })
  })

  it('overwrites existing value', () => {
    const obj: Record<string, unknown> = { a: { b: 'old' } }
    setNestedValue(obj, 'a.b', 'new')
    expect(obj).toEqual({ a: { b: 'new' } })
  })

  it('creates intermediate over non-object', () => {
    const obj: Record<string, unknown> = { a: 'string' }
    setNestedValue(obj, 'a.b', 'val')
    expect(obj).toEqual({ a: { b: 'val' } })
  })
})

describe('removeNestedValue', () => {
  it('removes a top-level key', () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 }
    expect(removeNestedValue(obj, 'a')).toBe(true)
    expect(obj).toEqual({ b: 2 })
  })

  it('removes a deeply nested key', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 1, d: 2 } } }
    expect(removeNestedValue(obj, 'a.b.c')).toBe(true)
    expect(obj).toEqual({ a: { b: { d: 2 } } })
  })

  it('cleans up empty parent objects', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 1 } }, x: 1 }
    expect(removeNestedValue(obj, 'a.b.c')).toBe(true)
    expect(obj).toEqual({ x: 1 })
  })

  it('returns false for missing key', () => {
    const obj: Record<string, unknown> = { a: 1 }
    expect(removeNestedValue(obj, 'b')).toBe(false)
    expect(obj).toEqual({ a: 1 })
  })

  it('returns false for path through non-object', () => {
    const obj: Record<string, unknown> = { a: 'string' }
    expect(removeNestedValue(obj, 'a.b')).toBe(false)
  })
})

describe('hasNestedKey', () => {
  it('returns true for existing key', () => {
    expect(hasNestedKey({ a: { b: 1 } }, 'a.b')).toBe(true)
  })

  it('returns false for missing key', () => {
    expect(hasNestedKey({ a: { b: 1 } }, 'a.c')).toBe(false)
  })

  it('returns true for nested object (non-leaf)', () => {
    expect(hasNestedKey({ a: { b: { c: 1 } } }, 'a.b')).toBe(true)
  })
})

describe('getLeafKeys', () => {
  it('returns leaf keys from flat object', () => {
    expect(getLeafKeys({ a: 1, b: 2 })).toEqual(['a', 'b'])
  })

  it('returns leaf keys from nested object', () => {
    const obj = { a: { b: 1, c: { d: 2 } }, e: 3 }
    expect(getLeafKeys(obj)).toEqual(['a.b', 'a.c.d', 'e'])
  })

  it('returns empty array for empty object', () => {
    expect(getLeafKeys({})).toEqual([])
  })

  it('handles arrays as leaf values', () => {
    const obj = { a: [1, 2, 3] }
    expect(getLeafKeys(obj)).toEqual(['a'])
  })

  it('uses prefix when provided', () => {
    expect(getLeafKeys({ x: 1 }, 'root')).toEqual(['root.x'])
  })
})

describe('sortKeysDeep', () => {
  it('sorts top-level keys', () => {
    const obj = { c: 1, a: 2, b: 3 }
    expect(Object.keys(sortKeysDeep(obj))).toEqual(['a', 'b', 'c'])
  })

  it('sorts nested keys', () => {
    const obj = { b: { d: 1, c: 2 }, a: 3 }
    const sorted = sortKeysDeep(obj)
    expect(Object.keys(sorted)).toEqual(['a', 'b'])
    expect(Object.keys(sorted.b as Record<string, unknown>)).toEqual(['c', 'd'])
  })

  it('does not mutate original', () => {
    const obj = { c: 1, a: 2 }
    sortKeysDeep(obj)
    expect(Object.keys(obj)).toEqual(['c', 'a'])
  })

  it('preserves arrays as-is', () => {
    const obj = { a: [3, 1, 2] }
    expect(sortKeysDeep(obj)).toEqual({ a: [3, 1, 2] })
  })
})

describe('renameNestedKey', () => {
  it('renames a leaf key', () => {
    const obj: Record<string, unknown> = { a: { b: 'val' } }
    expect(renameNestedKey(obj, 'a.b', 'a.c')).toBe(true)
    expect(obj).toEqual({ a: { c: 'val' } })
  })

  it('moves a key to a different namespace', () => {
    const obj: Record<string, unknown> = { old: { key: 'val' }, other: 1 }
    expect(renameNestedKey(obj, 'old.key', 'new.key')).toBe(true)
    expect(obj).toEqual({ new: { key: 'val' }, other: 1 })
  })

  it('returns false if old key does not exist', () => {
    const obj: Record<string, unknown> = { a: 1 }
    expect(renameNestedKey(obj, 'b', 'c')).toBe(false)
  })

  it('moves entire nested subtree', () => {
    const obj: Record<string, unknown> = { a: { b: { c: 1, d: 2 } } }
    expect(renameNestedKey(obj, 'a.b', 'x.y')).toBe(true)
    expect(obj).toEqual({ x: { y: { c: 1, d: 2 } } })
  })
})
