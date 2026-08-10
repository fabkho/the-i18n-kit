import sortKeys from 'sort-keys'

/**
 * Get a value from a nested object using a dot-separated path.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Set a value in a nested object using a dot-separated path.
 * Creates intermediate objects as needed.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  const lastKey = parts.pop()
  if (lastKey === undefined) return
  let current: Record<string, unknown> = obj
  for (const part of parts) {
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[lastKey] = value
}

/**
 * Remove a value from a nested object using a dot-separated path.
 * Cleans up empty parent objects after removal.
 * Returns true if the key was found and removed.
 */
export function removeNestedValue(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.')
  const lastKey = parts.pop()
  if (lastKey === undefined) return false
  const parents: Array<{ obj: Record<string, unknown>; key: string }> = []
  let current: Record<string, unknown> = obj

  for (const part of parts) {
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      return false
    }
    parents.push({ obj: current, key: part })
    current = current[part] as Record<string, unknown>
  }

  if (!(lastKey in current)) {
    return false
  }

  delete current[lastKey]

  for (const { obj: parentObj, key } of [...parents].reverse()) {
    const child = parentObj[key] as Record<string, unknown>
    if (Object.keys(child).length === 0) {
      delete parentObj[key]
    } else {
      break
    }
  }

  return true
}

/**
 * Check if a key exists in a nested object.
 */
export function hasNestedKey(obj: Record<string, unknown>, path: string): boolean {
  return getNestedValue(obj, path) !== undefined
}

/**
 * Get all leaf keys as dot-separated paths.
 * A leaf key is one whose value is not a plain object (i.e., it's a string, number, array, etc.).
 */
export function getLeafKeys(obj: Record<string, unknown>, prefix = '', depth = 0): string[] {
  if (depth > 200) return [] // guard against deeply nested objects
  const keys: string[] = []
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    const value = obj[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getLeafKeys(value as Record<string, unknown>, fullPath, depth + 1))
    } else {
      keys.push(fullPath)
    }
  }
  return keys
}

/**
 * Sort keys alphabetically at every nesting level (deep).
 * Returns a new object — does not mutate the input.
 */
export const sortKeysDeep = (obj: Record<string, unknown>): Record<string, unknown> =>
  sortKeys(obj, { deep: true }) as Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reorder `data` (deeply) against a `reference` object that carries the
 * authoritative key order (typically the on-disk state before a mutation):
 *
 * - Keys that also exist in `reference` keep the reference's relative order.
 * - Keys new to `data` are inserted in sorted position among their siblings
 *   (after the last existing sibling that sorts before them), so additions
 *   land alphabetically without re-sorting existing keys.
 * - Without a reference, all keys are sorted (equivalent to sortKeysDeep).
 *
 * Returns a new object — does not mutate the input.
 */
export function orderKeysPreserving(
  data: Record<string, unknown>,
  reference?: Record<string, unknown>,
): Record<string, unknown> {
  const orderedKeys = reference ? Object.keys(reference).filter(k => k in data) : []
  const existing = new Set(orderedKeys)
  const newKeys = Object.keys(data).filter(k => !existing.has(k)).sort()

  for (const key of newKeys) {
    let insertAt = 0
    for (let i = orderedKeys.length - 1; i >= 0; i--) {
      const existingKey = orderedKeys[i]
      if (existingKey !== undefined && existingKey <= key) {
        insertAt = i + 1
        break
      }
    }
    orderedKeys.splice(insertAt, 0, key)
  }

  const result: Record<string, unknown> = {}
  for (const key of orderedKeys) {
    result[key] = orderValuePreserving(data[key], reference?.[key])
  }
  return result
}

function orderValuePreserving(value: unknown, refValue: unknown): unknown {
  if (Array.isArray(value)) {
    const refArray = Array.isArray(refValue) ? refValue : undefined
    return value.map((item, i) => orderValuePreserving(item, refArray?.[i]))
  }
  if (isPlainObject(value)) {
    return orderKeysPreserving(value, isPlainObject(refValue) ? refValue : undefined)
  }
  return value
}

/**
 * Rename a key in a nested object. Preserves the value.
 * Returns true if the old key was found and renamed.
 */
export function renameNestedKey(
  obj: Record<string, unknown>,
  oldPath: string,
  newPath: string,
): boolean {
  const value = getNestedValue(obj, oldPath)
  if (value === undefined) {
    return false
  }
  removeNestedValue(obj, oldPath)
  setNestedValue(obj, newPath, value)
  return true
}

/**
 * Validate a translation value. Returns a warning message if problematic, null if OK.
 * This is soft validation — callers should warn but not block.
 */
export function validateTranslationValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return `Value must be a string, got ${typeof value}`
  }

  const openBraces = (value.match(/\{/g) || []).length
  const closeBraces = (value.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    return `Unbalanced placeholder braces: ${openBraces} opening vs ${closeBraces} closing in "${value}"`
  }

  if (value.includes('@:') && /@:\s*$/.test(value)) {
    return `Malformed linked reference: "@:" at end of string with no target`
  }

  return null
}
