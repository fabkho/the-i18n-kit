/**
 * Contract tests for the published JSON Schema, `packages/mcp/schema.json`.
 *
 * It ships in the mcp package's `files` array and users point `$schema` at it,
 * so it is the schema editors validate against. It is generated from the zod
 * schema that validates config at runtime (#346) — this test fails if the
 * committed file drifts from the generator, and asserts the two divergences
 * that motivated generating it, so a future reader knows what regressed
 * before: `framework` rejecting shipped adapters, and the deprecated
 * `samplingPreferences` key being rejected by a strict schema that omitted it.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderConfigJsonSchema } from '../../src/config/schema-json'
import { projectConfigSchema } from '../../src/config/schema'
import { listAdapterNames } from '../../src/adapters/registry'

const schemaPath = resolve(import.meta.dirname, '../../../mcp/schema.json')

async function loadPublishedSchema(): Promise<{ raw: string, doc: Record<string, any> }> {
  const raw = await readFile(schemaPath, 'utf-8')
  return { raw, doc: JSON.parse(raw) as Record<string, any> }
}

describe('packages/mcp/schema.json', () => {
  it('matches what the generator produces (run `pnpm generate:schema`)', async () => {
    const { raw } = await loadPublishedSchema()
    expect(raw).toBe(renderConfigJsonSchema())
  })

  it('keeps the document metadata consumers point $schema at', async () => {
    const { doc } = await loadPublishedSchema()
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(doc.$id).toBe(
      'https://raw.githubusercontent.com/fabkho/the-i18n-kit/main/packages/mcp/schema.json',
    )
    expect(doc.title).toBe('the-i18n-kit project configuration')
    expect(doc.description).toBeTruthy()
    // Self-contained: no $ref out of the file, nothing to resolve.
    expect(JSON.stringify(doc)).not.toContain('$ref')
  })

  it('describes every field, since editors surface the text as tooltips', async () => {
    const { doc } = await loadPublishedSchema()
    for (const [name, property] of Object.entries<any>(doc.properties)) {
      expect(property.description, `${name} has no description`).toBeTruthy()
    }
  })

  // ─── Regression: framework used to be an enum of three adapters ───
  //
  // Adapters are a runtime registry, so zod leaves `framework` a plain string.
  // The hand-written schema hard-coded enum: ["nuxt", "laravel", "generic"],
  // which flagged "vue" and "react" as invalid even though both adapters ship.

  it('suggests every registered adapter for framework without constraining it', async () => {
    const { doc } = await loadPublishedSchema()
    const framework = doc.properties.framework

    expect(framework.enum).toBeUndefined()
    expect(framework.examples).toEqual(listAdapterNames())
    expect(framework.examples).toEqual(expect.arrayContaining(['nuxt', 'laravel', 'generic', 'vue', 'react']))
  })

  it('validates framework set to any registered adapter, and to an unlisted value', () => {
    for (const name of listAdapterNames()) {
      expect(projectConfigSchema.safeParse({ framework: name }).success, name).toBe(true)
    }
    // An adapter that does not exist yet must not fail schema validation —
    // detection reports an unknown hint, the schema does not pre-empt it.
    expect(projectConfigSchema.safeParse({ framework: 'svelte' }).success).toBe(true)
  })

  // ─── Regression: samplingPreferences was rejected by the published schema ───
  //
  // The key is deprecated, warned about and dropped — accepted on purpose so
  // existing config files keep validating. The published schema was
  // additionalProperties: false and omitted it, rejecting exactly the configs
  // the deprecation was designed to keep working.

  it('accepts the deprecated samplingPreferences key and marks it deprecated', async () => {
    const { doc } = await loadPublishedSchema()

    expect(doc.additionalProperties).toBe(false)
    expect(doc.properties.samplingPreferences).toBeDefined()
    expect(doc.properties.samplingPreferences.deprecated).toBe(true)
    expect(doc.properties.samplingPreferences.description).toMatch(/deprecated/i)

    expect(projectConfigSchema.safeParse({
      samplingPreferences: { hints: [{ name: 'claude-3-5-sonnet' }] },
    }).success).toBe(true)
  })

  it('still accepts the self-referential $schema key', async () => {
    const { doc } = await loadPublishedSchema()
    expect(doc.properties.$schema.type).toBe('string')
    expect(projectConfigSchema.safeParse({ $schema: './schema.json' }).success).toBe(true)
  })
})
