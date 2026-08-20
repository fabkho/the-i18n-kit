/**
 * The reference builder.
 *
 * One function, already-loaded sources in, a map of output path to page content
 * out, and no filesystem access anywhere beneath it. The thin shell that reads
 * the sources and writes the map lives in `docs/generate/index.ts`.
 *
 * The split exists so the generation logic is testable without a repository on
 * disk, and so a further source — the config schema — becomes another field on
 * `ReferenceSources` and another entry in `SECTIONS` rather than another script,
 * as the MCP tool listing and the action manifest already did.
 *
 * A section's page need not live under `DIR`: the configuration reference is
 * emitted into the hand-written configuration section, because its route is part
 * of the site's structure and three concept pages link it there. `SECTIONS`
 * stays the one list of what is generated either way.
 */

import { renderActionReference } from './action-pages.js'
import { renderCliReference } from './cli-pages.js'
import { CONFIG_REFERENCE_ROUTE, renderConfigReference } from './config-pages.js'
import { renderMcpReference } from './mcp-pages.js'
import { GENERATED_NOTICE, frontmatter, page, table } from './markdown.js'
import type { ReferenceOutput, ReferenceSources } from './types.js'

/** Directory under `docs/content`. The numeric prefix is stripped from the route. */
const DIR = '9.reference'

/** One row per generated reference, for the section landing page. */
interface Section {
  title: string
  route: string
  summary: string
  render: (sources: ReferenceSources) => ReferenceOutput
}

const SECTIONS: Section[] = [
  {
    title: 'CLI Commands',
    route: '/reference/cli',
    summary: 'Every command, its flags, its exit codes and its CI gates, generated from the command definitions.',
    render: sources => renderCliReference(sources.cli),
  },
  {
    title: 'MCP Tools',
    route: '/reference/mcp',
    summary: 'Every tool the MCP server advertises and the parameters it accepts, generated from the listing a host receives over stdio.',
    // The CLI's exposed commands come along so a tool paired with a command
    // links to a page that exists.
    render: sources => renderMcpReference(sources.mcp, sources.cli.exposed),
  },
  {
    title: 'GitHub Action',
    route: '/reference/action',
    summary: 'Every input, with its required status and default, and every output, generated from the action manifest.',
    render: sources => renderActionReference(sources.action),
  },
  {
    title: 'Configuration Fields',
    route: CONFIG_REFERENCE_ROUTE,
    summary: 'Every field a config file accepts, its type, its constraints and where it may be declared, generated from the schema that validates it.',
    render: sources => renderConfigReference(sources.config),
  },
]

export function buildReference(sources: ReferenceSources): ReferenceOutput {
  const output: ReferenceOutput = new Map()

  for (const section of SECTIONS) {
    for (const [path, content] of section.render(sources)) {
      output.set(path, content)
    }
  }
  output.set(`${DIR}/index.md`, renderIndex())

  return output
}

function renderIndex(): string {
  const rows = SECTIONS.map(section => [
    `[${section.title}](${section.route})`,
    section.summary,
  ])
  return page([
    frontmatter({
      title: 'Reference',
      description: 'Generated reference material for the-i18n-kit.',
    }),
    GENERATED_NOTICE,
    '# Reference',
    'Everything on these pages is generated from the source it documents, so it cannot describe a flag, tool or field that no longer exists. CI regenerates them on every pull request and fails when the committed output no longer matches.',
    table(['Reference', 'Covers'], rows),
  ])
}
