/**
 * Assertion helpers for the reference builder's output.
 *
 * These read the observable contract of a page — which flags it documents,
 * which description it carries — without depending on headings, table column
 * order or wording. A reworded heading must not fail a test; a flag that
 * stopped being documented must.
 */

import type { ReferenceOutput } from '../../generate/reference/types.js'

export const CLI_DIR = '9.reference/1.cli'
export const MCP_DIR = '9.reference/2.mcp'
const ACTION_PATH = '9.reference/3.action.md'

export function overview(output: ReferenceOutput): string {
  return read(output, `${CLI_DIR}/index.md`)
}

export function commandPage(output: ReferenceOutput, name: string): string {
  return read(output, `${CLI_DIR}/${name}.md`)
}

export function mcpOverview(output: ReferenceOutput): string {
  return read(output, `${MCP_DIR}/index.md`)
}

export function toolPage(output: ReferenceOutput, name: string): string {
  return read(output, `${MCP_DIR}/${name}.md`)
}

export function actionPage(output: ReferenceOutput): string {
  return read(output, ACTION_PATH)
}

function read(output: ReferenceOutput, path: string): string {
  const content = output.get(path)
  if (content === undefined) {
    throw new Error(`No page at ${path}. Generated: ${[...output.keys()].join(', ')}`)
  }
  return content
}

/** Every flag the page documents as code, e.g. `--dryRun`. */
export function documentedFlags(markdown: string): Set<string> {
  const matches = markdown.matchAll(/`--([A-Za-z][\w-]*)[^`]*`/g)
  return new Set([...matches].map(match => match[1] as string))
}

/** The command names a CLI reference run produced pages for. */
export function pagedCommands(output: ReferenceOutput): Set<string> {
  return pageNames(output, CLI_DIR)
}

/** The tool names an MCP reference run produced pages for. */
export function pagedTools(output: ReferenceOutput): Set<string> {
  return pageNames(output, MCP_DIR)
}

function pageNames(output: ReferenceOutput, dir: string): Set<string> {
  const names = [...output.keys()]
    .filter(path => path.startsWith(`${dir}/`) && path !== `${dir}/index.md`)
    .map(path => path.slice(`${dir}/`.length).replace(/\.md$/, ''))
  return new Set(names)
}

/**
 * The part of a page under one heading, so a page carrying an input table and an
 * output table can be read a table at a time. Matched on the heading text rather
 * than its level, and the tests that use it accept any wording change to the
 * heading — only its disappearance is a failure.
 */
export function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading)
  if (start === -1) {
    throw new Error(`No "${heading}" section on the page.`)
  }
  const rest = markdown.slice(start + heading.length)
  const end = rest.search(/\n#{2,}\s/)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * The identifiers a table documents: the code span in each row's first cell.
 * Rows whose first cell is a link — a tool or command index — are not entries.
 */
export function rowNames(markdown: string): Set<string> {
  const matches = markdown.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)
  return new Set([...matches].map(match => match[1] as string))
}

/**
 * The cells of the row documenting `name`, trimmed, without the outer pipes.
 * Split on unescaped pipes only: a cell carrying `"add" \| "update"` is one
 * cell, and splitting it would report the row as having more columns than it has.
 */
export function tableRow(markdown: string, name: string): string[] {
  const line = markdown.split('\n').find(candidate => candidate.startsWith(`| \`${name}\` |`))
  if (line === undefined) {
    throw new Error(`No table row for \`${name}\`.`)
  }
  return line.split(/(?<!\\)\|/).slice(1, -1).map(part => part.trim())
}
