/**
 * Fixture sources for the reference builder.
 *
 * The builder takes already-loaded sources, so a fixture is a plain object and
 * no test needs a repository on disk. Kept deliberately small: two commands
 * sharing a flag, one alias, one unexposed command — enough to exercise every
 * branch of the shared/specific split — two advertised tools, and an action
 * manifest carrying one input of each required/default combination.
 */

import type {
  ActionSource,
  CliCommandEntry,
  CliSource,
  McpSource,
  McpToolListing,
  ReferenceSources,
} from '../../generate/reference/types.js'

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

/** Advertised with no paired CLI command, and with only the universal parameter. */
export const DISCOVER_TOOL: McpToolListing = {
  name: 'discover',
  title: 'Discover i18n Setup',
  description: 'Discover the complete i18n setup. Call this first.',
  inputSchema: {
    type: 'object',
    properties: {
      projectDir: { type: 'string', description: 'Absolute path to the project root.' },
    },
  },
}

/**
 * Every schema shape the reference has to name a type for, plus behaviour
 * hints, a required parameter and a pairing with a command the fixture CLI
 * exposes.
 */
export const TRANSLATE_MISSING_TOOL: McpToolListing = {
  name: 'translate_missing',
  title: 'Translate Missing',
  description: 'Find keys missing in target locales and translate them. Provider mode | agent mode.',
  inputSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string', description: 'Layer name' },
      targetLocales: {
        description: 'Target locales, or "all"',
        anyOf: [{ type: 'string', const: 'all' }, { type: 'array', items: { type: 'string' } }],
      },
      keys: { type: 'array', items: { type: 'string' }, description: 'Dot-separated key paths' },
      mode: { type: 'string', enum: ['add', 'update', 'upsert'], description: 'Write mode' },
      translations: {
        type: 'object',
        description: 'Map of key to locale values',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'object', additionalProperties: { type: 'string' } },
      },
      dryRun: { type: 'boolean', description: 'Preview without writing' },
      outputFile: { type: 'string', description: 'Absolute path to write full JSON output' },
      projectDir: { type: 'string', description: 'Absolute path to the Nuxt project root.' },
    },
    required: ['layer'],
  },
  annotations: { title: 'Translate Missing Translations', readOnlyHint: false },
}

export function fixtureMcpSource(overrides: Partial<McpSource> = {}): McpSource {
  return { tools: [DISCOVER_TOOL, TRANSLATE_MISSING_TOOL], ...overrides }
}

export function fixtureActionSource(overrides: Partial<ActionSource> = {}): ActionSource {
  return {
    name: 'the-i18n-kit — Auto-Translate Missing Keys',
    description: 'Find missing translation keys and translate them via LLM.',
    inputs: [
      { name: 'provider', description: 'LLM provider: openai, anthropic, or google', required: true },
      { name: 'batch_size', description: 'Keys per LLM call (default: 50)', required: false, default: '50' },
      {
        name: 'working_directory',
        description: 'Project root directory (default: github.workspace)',
        required: false,
        default: '${{ github.workspace }}',
      },
      {
        name: 'pr_branch',
        description: 'Branch name for the PR (default: i18n/translate-missing-<timestamp>)',
        required: false,
      },
    ],
    outputs: [
      { name: 'gate_tripped', description: 'Names of any CI gates that tripped.' },
      { name: 'pr_url', description: 'URL of the created PR (only when create_pr is true)' },
    ],
    ...overrides,
  }
}

/** Every source the builder needs, so a test overrides only the one it is about. */
export function fixtureSources(overrides: Partial<ReferenceSources> = {}): ReferenceSources {
  return {
    cli: fixtureCliSource(),
    mcp: fixtureMcpSource(),
    action: fixtureActionSource(),
    ...overrides,
  }
}
