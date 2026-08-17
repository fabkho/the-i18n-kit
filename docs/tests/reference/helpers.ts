/**
 * Assertion helpers for the reference builder's output.
 *
 * These read the observable contract of a page — which flags it documents,
 * which description it carries — without depending on headings, table column
 * order or wording. A reworded heading must not fail a test; a flag that
 * stopped being documented must.
 */

import { CONFIG_REFERENCE_PATH } from '../../generate/reference/config-pages.js'
import type { ReferenceOutput } from '../../generate/reference/types.js'

export const CLI_DIR = '9.reference/1.cli'

export function overview(output: ReferenceOutput): string {
  return read(output, `${CLI_DIR}/index.md`)
}

export function commandPage(output: ReferenceOutput, name: string): string {
  return read(output, `${CLI_DIR}/${name}.md`)
}

export function configPage(output: ReferenceOutput): string {
  return read(output, CONFIG_REFERENCE_PATH)
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

/** The first cell of every table row that opens with a code span or a link to one. */
function rowNames(markdown: string): string[] {
  const matches = markdown.matchAll(/^\| \[?`([^`]+)`/gm)
  return [...matches].map(match => match[1] as string)
}

/** The fields the configuration reference lists, read off its field table. */
export function documentedFields(markdown: string): Set<string> {
  const fields = section(markdown, '## Fields')
  return new Set(rowNames(fields))
}

/**
 * Every name the page documents in a table, fields and nested properties alike.
 * Used to assert a nested shape is documented rather than flattened away.
 */
export function documentedNames(markdown: string): Set<string> {
  return new Set(rowNames(markdown))
}

/** One section of a page, from its heading to the next heading of any level. */
export function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading)
  if (start === -1) throw new Error(`No ${heading} section. Page:\n${markdown}`)
  const rest = markdown.slice(start + heading.length)
  const next = /\n#{1,6} /.exec(rest)
  return next === null ? rest : rest.slice(0, next.index)
}

/**
 * The page as a reader sees it, with the escaping the markdown needed undone.
 *
 * A pipe would end a table cell and a `<` would open an HTML tag, so both are
 * escaped on the way in and both render as the character they stand for. A test
 * asserting a description is carried verbatim has to compare against what
 * renders, not against the escaping.
 */
export function renderedText(markdown: string): string {
  return markdown.replace(/\\\|/g, '|').replace(/&lt;/g, '<')
}

/** The command names a CLI reference run produced pages for. */
export function pagedCommands(output: ReferenceOutput): Set<string> {
  const names = [...output.keys()]
    .filter(path => path.startsWith(`${CLI_DIR}/`) && path !== `${CLI_DIR}/index.md`)
    .map(path => path.slice(`${CLI_DIR}/`.length).replace(/\.md$/, ''))
  return new Set(names)
}
