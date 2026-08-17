/**
 * Contract tests for the reference builder, driven entirely by fixture sources.
 *
 * Nothing here touches the filesystem: the builder takes already-loaded sources
 * and returns a map of output path to page content, so a fixture is a plain
 * object. These tests cover the rules the builder applies — the shared/specific
 * flag split, alias folding, the unexposed notice — independently of what the
 * CLI happens to register today.
 */

import { describe, expect, it } from 'vitest'
import { buildReference } from '../../generate/reference/build.js'
import { CONFIG_REFERENCE_ROUTE } from '../../generate/reference/config-pages.js'
import {
  FIXTURE_SCHEMA,
  HIDDEN_ENTRY,
  SCAN_ENTRY,
  TRANSLATE_ALIAS_ENTRY,
  TRANSLATE_ENTRY,
  fixtureCliSource,
  fixtureConfigSource,
  fixtureSources,
} from './fixtures.js'
import {
  CLI_DIR,
  commandPage,
  configPage,
  documentedFields,
  documentedFlags,
  documentedNames,
  overview,
  pagedCommands,
  renderedText,
  section,
} from './helpers.js'
import type { CliCommandEntry, ReferenceSources } from '../../generate/reference/types.js'

function build(overrides: Partial<ReferenceSources> = {}) {
  return buildReference(fixtureSources(overrides))
}

describe('buildReference', () => {
  it('returns page content keyed by content-relative path and touches no disk', () => {
    const output = build()
    for (const [path, content] of output) {
      expect(path).toMatch(/^[\w.\-/]+\.md$/)
      expect(path.startsWith('/')).toBe(false)
      expect(content.endsWith('\n')).toBe(true)
    }
  })

  it('gives every exposed command a page, and every page a title and description', () => {
    const output = build()
    expect(pagedCommands(output)).toEqual(new Set(['scan', 'translate']))

    for (const entry of [SCAN_ENTRY, TRANSLATE_ENTRY]) {
      const markdown = commandPage(output, entry.name)
      expect(markdown).toContain(`title: '${entry.name}'`)
      expect(markdown).toContain(entry.def.meta?.description)
    }
  })

  it('documents each command-specific flag on its own command page', () => {
    const output = build()
    expect(documentedFlags(commandPage(output, 'scan'))).toEqual(
      new Set(['keys', 'outputFile']),
    )
    expect(documentedFlags(commandPage(output, 'translate'))).toEqual(
      new Set(['layer', 'provider', 'failOnFailed']),
    )
  })

  it('renders flags shared by every command once on the overview, never per command', () => {
    const output = build()
    expect(documentedFlags(overview(output))).toContain('json')
    expect(documentedFlags(overview(output))).toContain('projectDir')

    for (const name of pagedCommands(output)) {
      const flags = documentedFlags(commandPage(output, name))
      expect(flags).not.toContain('json')
      expect(flags).not.toContain('projectDir')
    }
  })

  it('carries each command description into the overview table verbatim', () => {
    const markdown = overview(build())
    for (const entry of [SCAN_ENTRY, TRANSLATE_ENTRY]) {
      expect(markdown).toContain(entry.def.meta?.description)
    }
  })

  it('folds an alias into the command it aliases instead of emitting a second page', () => {
    const output = build()
    expect(output.has(`${CLI_DIR}/${TRANSLATE_ALIAS_ENTRY.name}.md`)).toBe(false)

    const markdown = commandPage(output, 'translate')
    expect(markdown).toContain(TRANSLATE_ALIAS_ENTRY.name)
    expect(markdown).toContain(TRANSLATE_ALIAS_ENTRY.def.meta?.description)
    expect(overview(output)).toContain(TRANSLATE_ALIAS_ENTRY.name)
  })

  it('omits a command the CLI does not expose, and never mentions it', () => {
    // The CLI filters these out of its own registry, so running one prints
    // "Unknown command". Documenting an uninvokable command — even behind a
    // warning — advertises an internal decision as a gap in the tool.
    const output = build()
    expect(output.has(`${CLI_DIR}/${HIDDEN_ENTRY.name}.md`)).toBe(false)
    expect(overview(output)).not.toContain(HIDDEN_ENTRY.name)
  })

  it('documents every exit code the CLI can set, and the gate flags that reach code 2', () => {
    const cli = fixtureCliSource({ exitCodes: { success: 0, runFailed: 3, gateTripped: 4 } })
    const markdown = overview(build({ cli }))

    // Read from the source rather than hard-coded, so a renumbering shows up as
    // a documentation change rather than a passing test.
    expect(markdown).toMatch(/\|\s*3\s*\|/)
    expect(markdown).toMatch(/\|\s*4\s*\|/)
    expect(documentedFlags(markdown)).toContain('failOnFailed')
  })

  it('escapes a pipe inside a flag description so the table row survives', () => {
    const markdown = commandPage(build(), 'translate')
    expect(markdown).not.toMatch(/openai\|anthropic\|google/)
    expect(markdown).toContain('openai\\|anthropic\\|google')
  })

  it('produces a complete page for a newly registered command with no other change', () => {
    const added: CliCommandEntry = {
      name: 'find-unused',
      def: {
        meta: { name: 'find-unused', description: 'Report keys with no usage evidence' },
        args: {
          ...(SCAN_ENTRY.def.args ?? {}),
          strict: { type: 'boolean', description: 'Treat uncertain keys as unused', default: false },
        },
        run: () => Promise.resolve(),
      },
    }
    const cli = fixtureCliSource({
      entries: [...fixtureCliSource().entries, added],
      exposed: [...fixtureCliSource().exposed, 'find-unused'],
    })
    const output = build({ cli })

    const markdown = commandPage(output, 'find-unused')
    expect(markdown).toContain('Report keys with no usage evidence')
    expect(documentedFlags(markdown)).toContain('strict')
    expect(overview(output)).toContain('find-unused')
  })

  it('lists every generated reference on the section landing page', () => {
    const markdown = build().get('9.reference/index.md')
    expect(markdown).toBeDefined()
    expect(markdown).toContain('/reference/cli')
    expect(markdown).toContain(CONFIG_REFERENCE_ROUTE)
  })
})

describe('the configuration reference, from a fixture schema', () => {
  it('lists every field the schema declares, and nothing else', () => {
    const markdown = configPage(build())
    expect(documentedFields(markdown)).toEqual(new Set(Object.keys(FIXTURE_SCHEMA.properties)))
  })

  it('carries every description the schema declares, verbatim', () => {
    const markdown = renderedText(configPage(build()))
    for (const node of Object.values(FIXTURE_SCHEMA.properties)) {
      expect(markdown).toContain(node.description)
    }
  })

  it('renders the type and the constraints the schema imposes', () => {
    const markdown = configPage(build())
    // A union renders as its members, not as the word "union", and an array of
    // one keeps the constraint on the entry rather than on the array.
    expect(markdown).toContain('`true \\| string`')
    expect(markdown).toContain('`Record<string, string>`')
    expect(markdown).toContain('each entry: minimum length 1')
    expect(markdown).toContain('suggested: "nuxt", "generic"')
  })

  it('marks a deprecated field as deprecated and keeps its migration note', () => {
    const row = fieldRow(configPage(build()), 'samplingPreferences')
    expect(row).toContain('deprecated')
    expect(row).toContain('configure a provider instead')
  })

  it('documents a nested object rather than flattening it to `object`', () => {
    const shape = section(configPage(build()), '### `layerRules`')
    // Including the optional property, and which of the three is required.
    expect(documentedNames(shape)).toEqual(new Set(['layer', 'when', 'note']))
    expect(shape).toMatch(/\| `layer` \| `string` \| yes \|/)
    expect(shape).toMatch(/\| `note` \| `string` \| no \|/)
  })

  it('documents both accepted forms of an entry, including the object one', () => {
    const shape = section(configPage(build()), '### `localeDirs`')
    expect(shape).toContain('Relative path to a locale directory.')

    // The object form's own properties, which a `string | object` union would
    // otherwise leave undocumented.
    const objectForm = shape.slice(shape.indexOf('form holds:'))
    expect(documentedNames(objectForm)).toEqual(new Set(['path', 'layer']))
    expect(objectForm).toContain('Layer name for this directory.')
  })

  it('documents a record entry and says that unlisted keys still validate', () => {
    const shape = section(configPage(build()), '### `orphanScan`')
    expect(documentedNames(shape)).toEqual(new Set(['ignorePatterns']))
    expect(shape).toContain('Properties beyond these are accepted')
  })

  it('states where each field may be declared, restrictions included', () => {
    const config = fixtureConfigSource()
    const markdown = configPage(build({ config }))

    for (const key of config.moduleOwnedKeys) {
      expect(fieldRow(markdown, key)).toContain('rejected by `@the-i18n-kit/nuxt`')
    }
    for (const key of config.untypedKeys) {
      expect(fieldRow(markdown, key)).toContain('`.i18n-mcp.json` only')
    }
    expect(fieldRow(markdown, 'framework')).toContain('Either config file')
  })

  it('names the options the i18nKit block accepts instead of these fields', () => {
    const markdown = configPage(build())
    for (const option of fixtureConfigSource().nuxtModuleOptions) {
      expect(markdown).toContain(`\`${option}\``)
    }
  })

  it('documents a field added to the schema with no other change', () => {
    const added = {
      type: 'string' as const,
      description: 'Where the CI report is written.',
    }
    const config = fixtureConfigSource({
      schema: {
        ...FIXTURE_SCHEMA,
        properties: { ...FIXTURE_SCHEMA.properties, ciReport: added },
      },
    })
    const markdown = configPage(build({ config }))

    expect(documentedFields(markdown)).toContain('ciReport')
    expect(markdown).toContain(added.description)
  })

  it('emits the page at the path whose route the concept pages link', () => {
    // The route follows from the file's location: numeric directory prefixes are
    // stripped, so this path and only this path serves /configuration/reference.
    const output = build()
    expect([...output.keys()]).toContain('5.configuration/4.reference.md')
    expect(CONFIG_REFERENCE_ROUTE).toBe('/configuration/reference')
  })
})

/** The field table row for one field, by the code span that opens it. */
function fieldRow(markdown: string, field: string): string {
  const row = section(markdown, '## Fields')
    .split('\n')
    .find(line => new RegExp(`^\\| \\[?\`${field.replace('$', '\\$')}\``).test(line))
  if (row === undefined) throw new Error(`No row for ${field} in the field table.`)
  return row
}
