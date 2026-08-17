/**
 * Fixture sources for the reference builder.
 *
 * The builder takes already-loaded sources, so a fixture is a plain object and
 * no test needs a repository on disk. Kept deliberately small: two commands
 * sharing a flag, one alias, one unexposed command — enough to exercise every
 * branch of the shared/specific split.
 */

import type { CliCommandEntry, CliSource } from '../../generate/reference/types.js'

/** Two commands, both declaring the same two flags identically. */
const SHARED_ARG_DEFS = {
  projectDir: { type: 'string', alias: 'd', description: 'Project directory (default: cwd)' },
  json: { type: 'boolean', description: 'Output as JSON (default for non-TTY)', default: false },
}

function handler(): Promise<void> {
  return Promise.resolve()
}

const scanHandler = handler
const translateHandler = handler.bind(null)
const hiddenHandler = handler.bind(null)

export const SCAN_ENTRY: CliCommandEntry = {
  name: 'scan',
  def: {
    meta: { name: 'scan', description: 'Scan source code for translation key usage' },
    args: {
      ...SHARED_ARG_DEFS,
      keys: { type: 'string', description: 'Comma-separated keys to filter by' },
      outputFile: { type: 'string', description: 'Write full output to file, return summary only' },
    },
    run: scanHandler,
  },
}

export const TRANSLATE_ENTRY: CliCommandEntry = {
  name: 'translate',
  def: {
    meta: { name: 'translate', description: 'Find missing translations and translate them' },
    args: {
      ...SHARED_ARG_DEFS,
      layer: { type: 'string', description: 'Layer name', required: true },
      provider: { type: 'string', description: 'LLM provider', valueHint: 'openai|anthropic|google' },
      failOnFailed: { type: 'boolean', description: 'Exit 2 when any key failed to translate (CI gate)', default: false },
    },
    run: translateHandler,
  },
}

/** Same handler as `translate`, which is how the builder recognises an alias. */
export const TRANSLATE_ALIAS_ENTRY: CliCommandEntry = {
  name: 'translate-missing',
  def: {
    meta: { name: 'translate-missing', description: 'Alias of "translate" — matches the MCP tool.' },
    args: TRANSLATE_ENTRY.def.args,
    run: translateHandler,
  },
}

/** Registered but absent from the exposed list. */
export const HIDDEN_ENTRY: CliCommandEntry = {
  name: 'detect',
  def: {
    meta: { name: 'detect', description: 'Detect i18n configuration from the project' },
    args: { ...SHARED_ARG_DEFS },
    run: hiddenHandler,
  },
}

export function fixtureCliSource(overrides: Partial<CliSource> = {}): CliSource {
  return {
    entries: [SCAN_ENTRY, TRANSLATE_ENTRY, TRANSLATE_ALIAS_ENTRY, HIDDEN_ENTRY],
    exposed: ['scan', 'translate', 'translate-missing'],
    exitCodes: { success: 0, runFailed: 1, gateTripped: 2 },
    ...overrides,
  }
}
