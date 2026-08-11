import type { TranslateFn } from '../../src/core/types.js'

/**
 * Shared fake-backend harness for translate seam tests: parses the batch a
 * TranslateFn receives and answers like a well-behaved provider, so the real
 * pipeline (batching, parsing, validation, writes) runs end to end.
 */

/** Extract the batch (compact single-line JSON) from the user message. */
export function parseBatch(userMessage: string): Record<string, string> {
  const line = userMessage.split('\n').find(l => l.trimStart().startsWith('{"'))
  if (!line) throw new Error(`No batch JSON found in user message:\n${userMessage}`)
  return JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)) as Record<string, string>
}

/** A well-behaved fake backend: translates every requested key. */
export function fakeTranslator(transform: (key: string, value: string) => string, wrap?: (json: string) => string): TranslateFn {
  return async ({ userMessage }) => {
    const batch = parseBatch(userMessage)
    const out = Object.fromEntries(Object.entries(batch).map(([k, v]) => [k, transform(k, v)]))
    const json = JSON.stringify(out)
    return { text: wrap ? wrap(json) : json, model: 'fake-model' }
  }
}

/** fakeTranslator that also records every batch it was asked to translate. */
export function countingTranslator(): { fn: TranslateFn, calls: Array<Record<string, string>> } {
  const calls: Array<Record<string, string>> = []
  const base = fakeTranslator((_k, v) => `[t] ${v}`)
  const fn: TranslateFn = async (req) => {
    calls.push(parseBatch(req.userMessage))
    return base(req)
  }
  return { fn, calls }
}
