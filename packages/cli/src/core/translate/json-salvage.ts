/**
 * Parsing of a translate response into a key → value object, including the
 * salvage path for responses the provider cut off mid-object.
 */

import { log } from '../../utils/logger.js'

export function extractJsonFromResponse(responseText: string): Record<string, unknown> {
  const trimmed = responseText.trim()

  // Tier 1: direct parse
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {}

  // Tier 2: strip markdown code fences
  if (trimmed.startsWith('```')) {
    const stripped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    try {
      return JSON.parse(stripped) as Record<string, unknown>
    } catch {}
  }

  // Tier 3: balanced bracket extraction — find first complete {...}
  const start = trimmed.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\' && inString) {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1)
          return JSON.parse(candidate) as Record<string, unknown>
        }
      }
    }
  }

  // Tier 4: the object never closed. Salvage the pairs that did arrive.
  //
  // Observed in the wild on a real Gemini response: the complete, correct
  // translation missing only its closing brace. Discarding the whole response
  // over two absent characters left keys untranslated across repeated runs,
  // and each rerun asked the model for them again.
  if (start !== -1) {
    const salvaged = salvageTruncatedObject(trimmed.slice(start))
    if (salvaged) {
      log.warn(
        `Translate response ended mid-object — recovered ${Object.keys(salvaged).length} complete pair(s). `
        + 'Remaining keys are reported as failed and can be retried.',
      )
      return salvaged
    }

    throw new Error(
      `Response ended mid-object before any pair completed. Preview: ${trimmed.substring(0, 200)}`,
    )
  }

  throw new Error(`No valid JSON object found in response. Preview: ${trimmed.substring(0, 200)}`)
}

/**
 * Close an object that was cut off, keeping the key/value pairs that arrived
 * whole. Tries the string as-is first — a response missing only its brace is
 * the common case — then falls back to the last pair that ended cleanly,
 * dropping whatever was half-written after it.
 */
function salvageTruncatedObject(text: string): Record<string, unknown> | null {
  for (const candidate of [text, text.slice(0, lastCompletePairEnd(text))]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(`${candidate}}`) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed
    }
    catch {
      // Try the shorter cut.
    }
  }

  return null
}

/**
 * Index of the last top-level comma — the boundary after the last pair that
 * completed. Commas inside strings do not count, which is why this scans
 * rather than searching: a translated value may contain one.
 */
function lastCompletePairEnd(text: string): number {
  let depth = 0
  let inString = false
  let escape = false
  let lastComma = 0

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 1) lastComma = i
  }

  return lastComma
}
