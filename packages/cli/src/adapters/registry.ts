import type { FrameworkAdapter } from './types'
import { ConfigError, toErrorMessage } from '../utils/errors'
import { log } from '../utils/logger'

const adapters: FrameworkAdapter[] = []

export function registerAdapter(adapter: FrameworkAdapter): void {
  adapters.push(adapter)
}

export function resetRegistry(): void {
  adapters.length = 0
}

/**
 * The names of every registered adapter, in registration order. The published
 * JSON Schema advertises these as `framework` suggestions, so an adapter added
 * later shows up in editors without anyone editing a list by hand.
 */
export function listAdapterNames(): string[] {
  return adapters.map(a => a.name)
}

export interface FrameworkMatch {
  adapter: FrameworkAdapter
  /** Detection score. 0 when the adapter was forced by hint rather than detected. */
  confidence: number
  /** Every adapter that scored above zero, best first — context for `init`. */
  runnersUp: Array<{ name: string; confidence: number }>
}

/**
 * Detect the framework and report how confidently. `detectFramework` returns
 * only the winner; `init` needs the score to tell a user why Nuxt was chosen
 * over generic, and a bare directory needs to be distinguishable from a
 * confident match rather than surfacing as a thrown error.
 */
export async function detectFrameworkMatch(
  projectDir: string,
  hint?: string,
): Promise<FrameworkMatch | undefined> {
  if (adapters.length === 0) {
    throw new ConfigError('No framework adapters registered.')
  }

  if (hint) {
    const match = adapters.find(a => a.name === hint)
    if (!match) return undefined
    return { adapter: match, confidence: 0, runnersUp: [] }
  }

  const scores = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return { adapter, confidence: await adapter.detect(projectDir) }
      }
      catch (error) {
        log.warn(`Adapter '${adapter.name}' detection failed: ${toErrorMessage(error)}`)
        return { adapter, confidence: 0 }
      }
    }),
  )

  const ranked = scores.filter(s => s.confidence > 0).sort((a, b) => b.confidence - a.confidence)
  const [best] = ranked
  if (!best) return undefined

  return {
    adapter: best.adapter,
    confidence: best.confidence,
    runnersUp: ranked.slice(1).map(s => ({ name: s.adapter.name, confidence: s.confidence })),
  }
}

export async function detectFramework(
  projectDir: string,
  hint?: string,
): Promise<FrameworkAdapter> {
  const match = await detectFrameworkMatch(projectDir, hint)
  if (match) return match.adapter

  if (hint) {
    throw new ConfigError(
      `Framework hint "${hint}" does not match any registered adapter. `
      + `Available: ${adapters.map(a => a.name).join(', ')}`,
    )
  }
  throw new ConfigError(
    `No framework detected for ${projectDir}. `
    + `Registered adapters: ${adapters.map(a => a.name).join(', ')}`,
  )
}
