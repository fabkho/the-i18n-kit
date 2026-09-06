/**
 * The guidance a translate result carries when nothing was translated, or when
 * only part of it was.
 *
 * This is the caller's prose, not the operation's: a terminal is told to pass
 * `--provider`, a host is told to translate the fallback contexts inline and
 * write them back. Both live here, side by side, because they describe the same
 * state — as two texts in two packages they said different things about it, and
 * the all-layers case was covered on one surface only.
 */

import type {
  TranslateKeyResult,
  TranslateMissingOutcome,
  TranslateMissingResult,
} from '../core/types.js'
import type { Surface } from './types.js'

const NO_PROVIDER_CLI = 'No provider configured — nothing was translated. Pass --provider and --model '
  + '(API key via --apiKey or the OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env vars) '
  + 'to translate automatically.'

const AGENT_MODE_MCP = 'Agent mode — no provider configured on the server. Use the fallbackContexts to translate '
  + 'inline, then call write_translations (mode: "upsert") to write the results. To enable '
  + 'provider mode, set I18N_PROVIDER, I18N_MODEL, and the provider API key env on the server process.'

const AGENT_MODE_KEY_MCP = 'Agent mode — no provider configured on the server. Use the fallbackContext to '
  + 'translate inline, then call write_translations (mode: "upsert") to write the results. To enable '
  + 'provider mode, set I18N_PROVIDER, I18N_MODEL, and the provider API key env on the server process.'

/**
 * Locales that lost at least one key, sorted for a stable message.
 * A bare `totalFailed: 141` says nothing about which languages shipped
 * incomplete — this is what makes the count actionable in a CI log.
 * Reads the full and the compact shapes, since either may reach here.
 */
export function localesWithFailures(result: TranslateMissingOutcome): string[] {
  const perLayer: TranslateMissingResult[] = 'layers' in result
    ? Object.values(result.layers)
    : [result]

  const locales = new Set<string>()
  for (const layer of perLayer) {
    for (const [locale, entry] of Object.entries(layer.results ?? {})) {
      if (entry.failed.length > 0) locales.add(locale)
    }
    for (const entry of layer.summary.byLocale ?? []) {
      if (entry.failed > 0) locales.add(entry.locale)
    }
  }
  return [...locales].sort()
}

/** True when any layer of the outcome carries fallback contexts to translate by hand. */
function hasFallbackContexts(result: TranslateMissingOutcome): boolean {
  // All-layers mode nests the fallback contexts per layer, so checking only the
  // top level would skip the guidance in exactly the case a layered project
  // hits by default.
  return 'layers' in result
    ? Object.values(result.layers).some(layer => layer.fallbackContexts)
    : Boolean(result.fallbackContexts)
}

export function applyTranslateMissingGuidance(
  result: TranslateMissingOutcome,
  surface: Surface,
): void {
  if (surface === 'mcp') {
    if (hasFallbackContexts(result) && result.summary) {
      (result.summary as Record<string, unknown>).message = AGENT_MODE_MCP
    }
    return
  }

  // Single-layer and all-layers results both carry summary.mode, so this needs
  // no narrowing.
  if (result.summary.mode === 'agent') {
    result.summary.message = NO_PROVIDER_CLI
    return
  }

  if (result.summary.totalFailed > 0) {
    // A partial failure exits 0 unless --failOnFailed was passed, so without
    // this the only trace of it is a count nobody reads. Re-running is the fix:
    // the keys are still missing, so the next run retries them.
    const affected = localesWithFailures(result)
    result.summary.message = `${result.summary.totalFailed} key(s) failed to translate`
      + (affected.length > 0 ? ` (locales: ${affected.join(', ')})` : '')
      + '. Those keys remain missing — re-run to retry them. '
      + 'Pass --fail-on-failed to make this exit 2 in CI.'
  }
}

export function applyTranslateKeyGuidance(result: TranslateKeyResult, surface: Surface): void {
  if (surface === 'mcp') {
    if (result.fallbackContext) result.message = AGENT_MODE_KEY_MCP
    return
  }

  // At a terminal, agent mode means exactly one thing: no provider was given.
  if (result.mode === 'agent' && result.skipped.some(skip => skip.reason === 'no-provider')) {
    result.message = NO_PROVIDER_CLI
  }
}
