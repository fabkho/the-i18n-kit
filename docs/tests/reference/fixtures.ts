/**
 * Fixture sources for the reference builder.
 *
 * The builder takes already-loaded sources, so a fixture is a plain object and
 * no test needs a repository on disk. Kept deliberately small: two commands
 * sharing a flag, one alias, one unexposed command — enough to exercise every
 * branch of the shared/specific split.
 */

import type {
  CliCommandEntry,
  CliSource,
  ConfigJsonSchema,
  ConfigSource,
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

/**
 * A JSON Schema in the shape `z.toJSONSchema()` emits for the config schema,
 * cut down to one field of each kind the reference has to render: a scalar with
 * a suggestion list, an array of objects, a record of objects that accepts
 * unlisted keys, a union, a constrained array, a key the Nuxt module derives, a
 * key the typed config's interface omits, and a deprecated one.
 */
export const FIXTURE_SCHEMA: ConfigJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: {
      type: 'string',
      description: 'Path or URL to the JSON schema for IDE autocompletion.',
    },
    framework: {
      type: 'string',
      description: 'Force framework detection instead of auto-detecting.',
      examples: ['nuxt', 'generic'],
    },
    glossary: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Term dictionary for consistent translations.',
    },
    layerRules: {
      type: 'array',
      description: 'Rules that decide which layer a new key belongs to.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['layer', 'when'],
        properties: {
          layer: { type: 'string', description: 'Layer name.' },
          when: { type: 'string', description: 'When a key belongs in this layer.' },
          note: { type: 'string', description: 'Optional aside.' },
        },
      },
    },
    orphanScan: {
      type: 'object',
      description: 'Per-layer configuration for orphan key detection.',
      additionalProperties: {
        type: 'object',
        additionalProperties: {},
        properties: {
          ignorePatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key globs to exclude from orphan detection.',
          },
        },
      },
    },
    localeDirs: {
      type: 'array',
      description: 'Locale directories for the generic adapter.',
      items: {
        anyOf: [
          { type: 'string', minLength: 1, description: 'Relative path to a locale directory.' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'layer'],
            properties: {
              path: { type: 'string', minLength: 1, description: 'Relative path.' },
              layer: { type: 'string', minLength: 1, description: 'Layer name for this directory.' },
            },
          },
        ],
      },
    },
    protectedLocales: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'Locales excluded from automatic translation.',
    },
    reportOutput: {
      description: 'Write full reports to <reportOutput>/<toolName>.json.',
      anyOf: [
        { type: 'boolean', const: true, description: 'Write to the default directory.' },
        { type: 'string', minLength: 1, description: 'A directory path of your own.' },
      ],
    },
    samplingPreferences: {
      deprecated: true,
      description: 'Deprecated and ignored — configure a provider instead.',
    },
  },
}

export function fixtureConfigSource(overrides: Partial<ConfigSource> = {}): ConfigSource {
  return {
    schema: FIXTURE_SCHEMA,
    moduleOwnedKeys: ['localeDirs'],
    untypedKeys: ['$schema', 'samplingPreferences'],
    nuxtModuleOptions: ['enabled', 'failOnInvalidConfig'],
    ...overrides,
  }
}

/** Every source the builder needs, with either half replaceable per test. */
export function fixtureSources(overrides: Partial<ReferenceSources> = {}): ReferenceSources {
  return { cli: fixtureCliSource(), config: fixtureConfigSource(), ...overrides }
}
