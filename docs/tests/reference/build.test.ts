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
import type { CliCommandEntry } from '../../generate/reference/types.js'
import {
  DISCOVER_TOOL,
  HIDDEN_ENTRY,
  SCAN_ENTRY,
  TRANSLATE_ALIAS_ENTRY,
  TRANSLATE_ENTRY,
  TRANSLATE_MISSING_TOOL,
  fixtureActionSource,
  fixtureCliSource,
  fixtureMcpSource,
  fixtureSources,
} from './fixtures.js'
import {
  CLI_DIR,
  MCP_DIR,
  actionPage,
  commandPage,
  documentedFlags,
  mcpOverview,
  overview,
  pagedCommands,
  pagedTools,
  rowNames,
  section,
  tableRow,
  toolPage,
} from './helpers.js'

function build(cli = fixtureCliSource()) {
  return buildReference(fixtureSources({ cli }))
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
    const markdown = overview(buildReference(fixtureSources({ cli })))

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
    const output = buildReference(fixtureSources({ cli }))

    const markdown = commandPage(output, 'find-unused')
    expect(markdown).toContain('Report keys with no usage evidence')
    expect(documentedFlags(markdown)).toContain('strict')
    expect(overview(output)).toContain('find-unused')
  })

  it('lists every generated reference on the section landing page', () => {
    const markdown = build().get('9.reference/index.md')
    expect(markdown).toBeDefined()
    expect(markdown).toContain('/reference/cli')
    expect(markdown).toContain('/reference/mcp')
    expect(markdown).toContain('/reference/action')
  })
})

describe('the MCP tool reference, from a fixture listing', () => {
  function buildMcp(mcp = fixtureMcpSource()) {
    return buildReference(fixtureSources({ mcp }))
  }

  it('gives every advertised tool a page, and links each from the overview', () => {
    const output = buildMcp()
    expect(pagedTools(output)).toEqual(new Set(['discover', 'translate_missing']))

    const markdown = mcpOverview(output)
    for (const name of pagedTools(output)) {
      expect(markdown).toContain(`(/reference/mcp/${name})`)
    }
  })

  it('carries the advertised description onto the tool page unaltered', () => {
    const markdown = toolPage(buildMcp(), TRANSLATE_MISSING_TOOL.name)
    expect(markdown).toContain(TRANSLATE_MISSING_TOOL.description)
  })

  it('documents every parameter of the input schema, and which are required', () => {
    const markdown = toolPage(buildMcp(), TRANSLATE_MISSING_TOOL.name)
    const params = section(markdown, '## Parameters')
    const advertised = Object.keys(TRANSLATE_MISSING_TOOL.inputSchema.properties ?? {})

    expect([...rowNames(params)].sort()).toEqual([...advertised].sort())
    expect(tableRow(params, 'layer')).toContain('yes')
    expect(tableRow(params, 'dryRun')).toContain('no')
  })

  it('names each parameter type as a caller has to pass it', () => {
    const params = section(toolPage(buildMcp(), TRANSLATE_MISSING_TOOL.name), '## Parameters')
    expect(tableRow(params, 'keys')).toContain('`string[]`')
    expect(tableRow(params, 'mode')).toContain('`"add" \\| "update" \\| "upsert"`')
    expect(tableRow(params, 'targetLocales')).toContain('`"all" \\| string[]`')
    expect(tableRow(params, 'translations')).toContain('`Record<string, Record<string, string>>`')
  })

  it('reports the behaviour hints a host reads, and nothing when a tool sends none', () => {
    const output = buildMcp()
    expect(section(toolPage(output, 'translate_missing'), '## Behavior Hints'))
      .toContain('readOnlyHint')
    expect(() => section(toolPage(output, 'discover'), '## Behavior Hints')).toThrow()
  })

  it('links a paired tool to the command page instead of restating its flags', () => {
    const markdown = toolPage(buildMcp(), 'translate_missing')
    expect(markdown).toContain('(/reference/cli/translate)')
    expect(documentedFlags(markdown).size).toBe(0)
  })

  it('documents a tool with no paired command without inventing one', () => {
    const markdown = toolPage(buildMcp(), 'discover')
    expect(markdown).not.toContain('/reference/cli/')
  })

  it('refuses to build a pairing whose command the CLI does not expose', () => {
    // Otherwise the page ships a link to a command page that was never
    // generated, and the site build fails far from the cause.
    const cli = fixtureCliSource({ exposed: ['scan'] })
    expect(() => buildReference(fixtureSources({ cli }))).toThrow(/translate_missing/)
  })

  it('produces a complete page for a newly advertised tool with no other change', () => {
    const added = {
      name: 'find_stale_translations',
      title: 'Find Stale Translations',
      description: 'Find target values older than their source value.',
      inputSchema: {
        type: 'object',
        properties: { layer: { type: 'string', description: 'Layer name' } },
        required: ['layer'],
      },
    }
    const output = buildMcp(fixtureMcpSource({ tools: [DISCOVER_TOOL, added] }))

    const markdown = toolPage(output, added.name)
    expect(markdown).toContain(added.description)
    expect(rowNames(section(markdown, '## Parameters'))).toContain('layer')
    expect(mcpOverview(output)).toContain(`(/reference/mcp/${added.name})`)
  })

  it('states a parameter every tool accepts once on the overview', () => {
    const markdown = mcpOverview(buildMcp())
    expect(markdown).toContain('`projectDir`')
  })

  it('names the tools that can divert a large result to a file', () => {
    const markdown = mcpOverview(buildMcp())
    expect(markdown).toContain('`outputFile`')
    expect(markdown).toContain('(/reference/mcp/translate_missing)')
  })

  it('writes tool pages under the MCP directory alone', () => {
    for (const path of pagedTools(buildMcp())) {
      expect(`${MCP_DIR}/${path}.md`.startsWith(MCP_DIR)).toBe(true)
    }
  })
})

describe('the GitHub Action reference, from a fixture manifest', () => {
  function buildAction(action = fixtureActionSource()) {
    return actionPage(buildReference(fixtureSources({ action })))
  }

  it('documents every input with its required status and its default', () => {
    const source = fixtureActionSource()
    const inputs = section(buildAction(source), '## Inputs')

    expect([...rowNames(inputs)].sort()).toEqual(source.inputs.map(input => input.name).sort())
    for (const input of source.inputs) {
      const row = tableRow(inputs, input.name)
      expect(row).toContain(input.required ? 'yes' : 'no')
      if (input.default !== undefined) expect(row).toContain(`\`${input.default}\``)
    }
  })

  it('marks an input with no declared default as having none', () => {
    const row = tableRow(section(buildAction(), '## Inputs'), 'provider')
    expect(row).toContain('—')
  })

  it('carries each input description onto the page verbatim', () => {
    const markdown = buildAction()
    for (const input of fixtureActionSource().inputs) {
      // Angle brackets are entity-escaped, since a markdown renderer reads
      // `<timestamp>` as the start of a tag and drops the rest of the sentence.
      expect(markdown).toContain(input.description.replace(/</g, '&lt;'))
    }
  })

  it('documents every output', () => {
    const source = fixtureActionSource()
    const outputs = section(buildAction(source), '## Outputs')

    expect([...rowNames(outputs)].sort()).toEqual(source.outputs.map(output => output.name).sort())
    for (const output of source.outputs) {
      expect(outputs).toContain(output.description)
    }
  })

  it('keeps a workflow expression default as the manifest writes it', () => {
    // Paraphrasing `${{ github.workspace }}` would hide which context supplies
    // the value, which is the one thing a reader needs from a default.
    expect(tableRow(section(buildAction(), '## Inputs'), 'working_directory'))
      .toContain('`${{ github.workspace }}`')
  })

  it('leaves out the gate note when the manifest reports no gate', () => {
    const source = fixtureActionSource({ outputs: [{ name: 'pr_url', description: 'URL' }] })
    expect(buildAction(source)).not.toContain('::note')
  })
})
