import { createCommand, splitList, providerArgs, resolveProviderTranslateFn } from './_shared.js'
import { translateMissing } from '../core/operations.js'
import type { TranslateMissingOutcome, TranslateMissingResult } from '../core/types.js'

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

export default createCommand({
  name: 'translate',
  description: 'Find missing translations and translate them via LLM. Requires --provider and --model for auto-translation.',
  args: {
    layer: { type: 'string', description: 'Layer name (default: all locale-backed layers, aggregated)' },
    ref: { type: 'string', description: 'Reference locale (default: project default)' },
    targets: { type: 'string', description: 'Comma-separated target locales (default: all except ref)' },
    keys: { type: 'string', description: 'Comma-separated keys to translate (default: all missing)' },
    batchSize: { type: 'string', description: 'Batch size (default: 50)' },
    ...providerArgs,
    dryRun: { type: 'boolean', description: 'Preview what would be translated', default: false },
    failOnFailed: { type: 'boolean', description: 'Exit 2 when any key failed to translate (CI gate)', default: false },
  },
  // Without this gate a partly failed run is indistinguishable from a clean one:
  // isTotalFailure only reports exit 1 when NOTHING was translated, so a run that
  // wrote 795 keys and lost 141 exits 0 and its partial result gets committed.
  // Opt-in rather than default, because providers fail transiently and a red
  // pipeline on every flake is a red pipeline nobody reads.
  gates: [{ flag: 'failOnFailed', counter: 'totalFailed', threshold: 0 }],
  async run(args) {
    let batchSize: number | undefined
    if (args.batchSize) {
      const num = Number(args.batchSize)
      if (!Number.isInteger(num) || num <= 0 || String(num) !== args.batchSize) {
        throw new Error(`Invalid --batchSize: "${args.batchSize}". Must be a positive integer`)
      }
      batchSize = num
    }

    const translateFn = await resolveProviderTranslateFn(args)

    const result = await translateMissing({
      layer: args.layer,
      referenceLocale: args.ref,
      targetLocales: splitList(args.targets),
      keys: splitList(args.keys),
      batchSize,
      dryRun: args.dryRun,
      projectDir: args.projectDir,
      translateFn,
    })

    // CLI-owned guidance: agent mode here just means no provider was given.
    // Single-layer and all-layers results both carry summary.mode, so this
    // needs no narrowing.
    if (result.summary.mode === 'agent') {
      result.summary.message = 'No provider configured — nothing was translated. Pass --provider and --model '
        + '(API key via --apiKey or the OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY env vars) '
        + 'to translate automatically.'
    } else if (result.summary.totalFailed > 0) {
      // A partial failure exits 0 unless --fail-on-failed was passed, so without
      // this the only trace of it is a count nobody reads. Re-running is the
      // fix: the keys are still missing, so the next run retries them.
      const affected = localesWithFailures(result)
      result.summary.message = `${result.summary.totalFailed} key(s) failed to translate`
        + (affected.length > 0 ? ` (locales: ${affected.join(', ')})` : '')
        + '. Those keys remain missing — re-run to retry them. '
        + 'Pass --fail-on-failed to make this exit 2 in CI.'
    }
    return result
  },
})
