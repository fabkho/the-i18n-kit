import { describe, it, expect } from 'vitest'
import {
  getNestedValue,
  setNestedValue,
  removeNestedValue,
  hasNestedKey,
  getLeafKeys,
  sortKeysDeep,
  orderKeysPreserving,
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

describe('orderKeysPreserving', () => {
  it('keeps existing keys in reference order without re-sorting', () => {
    const reference = { zebra: 1, apple: 2, mango: 3 }
    const data = { apple: 2, mango: 3, zebra: 1 }
    expect(Object.keys(orderKeysPreserving(data, reference))).toEqual(['zebra', 'apple', 'mango'])
  })

  it('inserts new keys in sorted position among existing siblings', () => {
    const reference = { apple: 1, mango: 2, zebra: 3 }
    const data = { apple: 1, mango: 2, zebra: 3, banana: 4, aardvark: 5 }
    expect(Object.keys(orderKeysPreserving(data, reference)))
      .toEqual(['aardvark', 'apple', 'banana', 'mango', 'zebra'])
  })

  it('inserts a new key after the last existing sibling that sorts before it (unsorted reference)', () => {
    const reference = { zebra: 1, apple: 2, mango: 3 }
    const data = { zebra: 1, apple: 2, mango: 3, banana: 4 }
    expect(Object.keys(orderKeysPreserving(data, reference)))
      .toEqual(['zebra', 'apple', 'banana', 'mango'])
  })

  it('drops keys removed from data', () => {
    const reference = { a: 1, b: 2, c: 3 }
    const data = { a: 1, c: 3 }
    expect(Object.keys(orderKeysPreserving(data, reference))).toEqual(['a', 'c'])
  })

  it('recurses into nested objects', () => {
    const reference = { outer: { zebra: 1, apple: 2 } }
    const data = { outer: { apple: 2, zebra: 1, banana: 3 } }
    const result = orderKeysPreserving(data, reference)
    expect(Object.keys(result.outer as Record<string, unknown>))
      .toEqual(['zebra', 'apple', 'banana'])
  })

  it('sorts everything when no reference is given (new file)', () => {
    const data = { z: { b: 1, a: 2 }, a: 3 }
    const result = orderKeysPreserving(data)
    expect(Object.keys(result)).toEqual(['a', 'z'])
    expect(Object.keys(result.z as Record<string, unknown>)).toEqual(['a', 'b'])
  })

  it('sorts nested objects whose reference value was not an object', () => {
    const reference = { key: 'string value' }
    const data = { key: { b: 1, a: 2 } }
    const result = orderKeysPreserving(data, reference)
    expect(Object.keys(result.key as Record<string, unknown>)).toEqual(['a', 'b'])
  })

  it('leaves arrays untouched but orders object elements inside them', () => {
    const reference = { list: [{ z: 1, a: 2 }, 'x'] }
    const data = { list: [{ a: 2, z: 1, m: 3 }, 'x', 'y'] }
    const result = orderKeysPreserving(data, reference)
    const list = result.list as unknown[]
    expect(Object.keys(list[0] as Record<string, unknown>)).toEqual(['z', 'a', 'm'])
    expect(list[1]).toBe('x')
    expect(list[2]).toBe('y')
  })

  it('does not mutate the input', () => {
    const data = { b: 1, a: 2 }
    orderKeysPreserving(data, { a: 2 })
    expect(Object.keys(data)).toEqual(['b', 'a'])
  })
})
