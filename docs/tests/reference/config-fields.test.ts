/**
 * Contract tests for the configuration reference against the real schema.
 *
 * The fixture tests in `build.test.ts` cover the builder's rules; these cover
 * the claim the site makes — that every field the kit accepts is documented,
 * with the type, the constraints and the description the schema declares. There
 * is no field list in this file to forget to update: every expectation is
 * derived from the schema, so adding a field and forgetting the docs cannot pass
 * here.
 *
 * Sources are loaded through the same loader the generator uses, so the only
 * disk access is the loader's own, plus the two concept pages whose links to
 * this reference are an acceptance criterion of #350 and were once removed for
 * pointing at a page that did not exist.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildConfigModel } from '../../generate/reference/config-model.js'
import { CONFIG_REFERENCE_ROUTE } from '../../generate/reference/config-pages.js'
import { buildReference } from '../../generate/reference/build.js'
import { loadCliSource } from '../../generate/sources/cli.js'
import { loadConfigSource } from '../../generate/sources/config.js'
import type { ConfigSource, JsonSchemaNode } from '../../generate/reference/types.js'
import { fixtureSources } from './fixtures.js'
import { configPage, documentedFields, documentedNames, renderedText, section } from './helpers.js'

const source: ConfigSource = await loadConfigSource()
// The other sources are fixtures: this file is about the configuration
// reference, and each of the others has a contract file of its own.
const output = buildReference(fixtureSources({ cli: await loadCliSource(), config: source }))
const markdown = configPage(output)
const model = buildConfigModel(source)

/** The pages that link this reference, relative to the docs package. */
const INBOUND_LINKS = [
  'content/5.configuration/1.where-config-lives.md',
  'content/5.configuration/3.declared-vs-derived.md',
]

describe('the configuration reference against the config schema', () => {
  it('documents every field the schema declares, and no other', () => {
    const declared = Object.keys(source.schema.properties)
    expect(declared.length).toBeGreaterThan(0)
    expect([...documentedFields(markdown)].sort()).toEqual([...declared].sort())
  })

  it('carries each field description exactly as the schema declares it', () => {
    const rendered = renderedText(markdown)

    for (const [name, node] of Object.entries(source.schema.properties)) {
      // Every field is documented for users through `.describe()`, so a field
      // without description text is a gap in the schema, not in the page.
      expect(node.description, `${name} declares no description`).toBeTruthy()
      expect(rendered).toContain(node.description)
    }
  })

  it('marks every deprecated field as deprecated, with the schema\'s migration note', () => {
    const deprecated = model.fields.filter(field => field.deprecated)
    expect(deprecated.length).toBeGreaterThan(0)

    for (const field of deprecated) {
      const row = fieldRow(field.name)
      expect(row).toContain('deprecated')
      expect(renderedText(row)).toContain(field.description)
    }
  })

  it('states, for every field, where it may be declared', () => {
    for (const field of model.fields) {
      expect(fieldRow(field.name)).toMatch(/(Either (config )?file|\.i18n-mcp\.json` only)/)
    }
  })

  it('names the fields the Nuxt module derives as rejected in a config file', () => {
    expect(source.moduleOwnedKeys.length).toBeGreaterThan(0)

    for (const key of source.moduleOwnedKeys) {
      expect(source.schema.properties[key], `${key} is not a schema field`).toBeDefined()
      expect(fieldRow(key)).toContain('rejected by `@the-i18n-kit/nuxt`')
    }
  })

  it('names the fields the typed config interface omits as JSON-only', () => {
    expect(source.untypedKeys.length).toBeGreaterThan(0)

    for (const key of source.untypedKeys) {
      expect(fieldRow(key)).toContain('`.i18n-mcp.json` only')
    }
  })

  it('documents every property of every nested shape, rather than flattening it', () => {
    const nested = [...nestedProperties(source.schema.properties)]
    expect(nested.length).toBeGreaterThan(0)

    // Read off the whole page rather than one section, so this holds however the
    // shapes are laid out — the claim is that the property is documented, not
    // where.
    const documented = documentedNames(markdown)
    for (const property of nested) expect(documented).toContain(property)
  })

  it('documents each accepted form of a field that accepts several', () => {
    for (const field of model.fields) {
      const forms = field.shape?.forms ?? []
      if (forms.length === 0) continue

      const shape = section(markdown, `### \`${field.name}\``)
      for (const form of forms) {
        expect(shape).toContain(`\`${form.type}\``)
        if (form.description !== '') expect(renderedText(shape)).toContain(form.description)
      }
    }
  })

  it('reports the adapter names the schema suggests for framework', () => {
    // The schema leaves `framework` open on purpose — the suggestions come from
    // the adapter registry, so a new adapter reaches the page by being
    // registered.
    const suggestions = source.schema.properties.framework?.examples ?? []
    expect(suggestions.length).toBeGreaterThan(0)

    for (const name of suggestions) expect(fieldRow('framework')).toContain(String(name))
  })

  it('is emitted at the route the concept pages link, and is linked from them', async () => {
    expect([...output.keys()]).toContain('5.configuration/4.reference.md')

    for (const path of INBOUND_LINKS) {
      const page = await readFile(new URL(`../../${path}`, import.meta.url), 'utf-8')
      expect(page, `${path} no longer links the field reference`)
        .toContain(`(${CONFIG_REFERENCE_ROUTE})`)
    }
  })
})

/** The field table row for one field, by the code span that opens it. */
function fieldRow(field: string): string {
  const row = section(markdown, '## Fields')
    .split('\n')
    .find(line => line.startsWith(`| \`${field}\``) || line.startsWith(`| [\`${field}\``))
  if (row === undefined) throw new Error(`No row for ${field} in the field table.`)
  return row
}

/**
 * Every property name declared inside a field's value — one level of array or
 * record unwrapping, then into each union member. These are the names that
 * disappear when a nested shape is rendered as `object`.
 */
function nestedProperties(properties: Record<string, JsonSchemaNode>): Set<string> {
  const names = new Set<string>()

  for (const node of Object.values(properties)) {
    const entry = node.items ?? recordValue(node)
    for (const candidate of [entry ?? node, ...(entry ?? node).anyOf ?? []]) {
      for (const name of Object.keys(candidate.properties ?? {})) names.add(name)
    }
  }
  return names
}

function recordValue(node: JsonSchemaNode): JsonSchemaNode | undefined {
  if (node.properties !== undefined) return undefined
  return typeof node.additionalProperties === 'object' ? node.additionalProperties : undefined
}
