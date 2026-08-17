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

export function overview(output: ReferenceOutput): string {
  return read(output, `${CLI_DIR}/index.md`)
}

export function commandPage(output: ReferenceOutput, name: string): string {
  return read(output, `${CLI_DIR}/${name}.md`)
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
  const names = [...output.keys()]
    .filter(path => path.startsWith(`${CLI_DIR}/`) && path !== `${CLI_DIR}/index.md`)
    .map(path => path.slice(`${CLI_DIR}/`.length).replace(/\.md$/, ''))
  return new Set(names)
}
