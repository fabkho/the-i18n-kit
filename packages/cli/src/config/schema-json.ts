/**
 * The published JSON Schema (`packages/mcp/schema.json`) as generated output of
 * the zod schema in `./schema.ts`.
 *
 * It used to be hand-written, and drifted: it hard-coded three adapter names in
 * an `enum` while zod deliberately leaves `framework` open (adapters are a
 * runtime registry), and it was `additionalProperties: false` without listing
 * the deprecated keys zod still accepts. Both made editors flag configuration
 * the tool happily runs. Generating it means the only way to change the
 * published contract is to change the schema that enforces it.
 *
 * Run `pnpm generate:schema` after touching `./schema.ts`; a test fails if the
 * committed file and this function disagree.
 */
import { z } from 'zod'
import { projectConfigSchema } from './schema.js'
import { listAdapterNames } from '../adapters/registry.js'
// Registers the built-in adapters, so their names can be advertised below.
import './detector.js'

/**
 * Metadata the published file carries that no zod field can express: consumers
 * point `$schema` at `$id`, so it is part of the contract.
 */
const documentMeta = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://raw.githubusercontent.com/fabkho/the-i18n-kit/main/packages/mcp/schema.json',
  title: 'the-i18n-mcp project configuration',
  description:
    'Configuration for the-i18n-kit. Declare it as i18n-kit.config.ts or .i18n-mcp.json at '
    + 'your project root — both accept this same shape. Every field is optional.',
} as const

function buildConfigJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(projectConfigSchema) as Record<string, unknown>
  const properties = generated.properties as Record<string, Record<string, unknown>>

  // Suggestions, not constraints: `framework` accepts any registered adapter
  // name, including ones added after this file was generated, so the names go
  // in as `examples` (which editors autocomplete) rather than an `enum` (which
  // they reject anything outside of).
  properties.framework = { ...properties.framework, examples: listAdapterNames() }

  const { $schema: _generatedDialect, ...body } = generated
  return { ...documentMeta, ...body }
}

/** The file as it should be committed — trailing newline included. */
export function renderConfigJsonSchema(): string {
  return `${JSON.stringify(buildConfigJsonSchema(), null, 2)}\n`
}
