/**
 * Renders the GitHub Action reference: one page, because the action has one
 * interface — its inputs and its outputs, both declared in the manifest.
 *
 * The manifest is what GitHub itself validates a workflow against, so an input
 * documented here is an input the action accepts, with the description, required
 * status and default it carries there.
 */

import { GENERATED_NOTICE, cell, code, frontmatter, page, prose, table, textCell } from './markdown.js'
import type { ActionInput, ActionOutput, ActionSource, ReferenceOutput } from './types.js'

/** A file rather than a directory: the numeric prefix is stripped from the route. */
const PATH = '9.reference/3.action.md'

/** The route of the generated CLI reference, which the exit-code note links into. */
const CLI_ROUTE = '/reference/cli'
const CLI_PACKAGE = '@the-i18n-kit/cli'

export function renderActionReference(source: ActionSource): ReferenceOutput {
  return new Map([[PATH, renderPage(source)]])
}

function renderPage(source: ActionSource): string {
  return page([
    frontmatter({
      title: 'GitHub Action',
      description: 'Every input and output of the composite action, generated from the action manifest.',
    }),
    GENERATED_NOTICE,
    prose(source.description),
    `The action installs ${code(CLI_PACKAGE)}, runs the [${code('translate')} command](${CLI_ROUTE}/translate), and opens a pull request with what it wrote. The command owns the pass/fail decision and reports it as an [exit code](${CLI_ROUTE}#exit-codes); the action reads counts for its outputs and the log only.`,
    `Inputs and outputs below are generated from ${code('action.yml')}, so a workflow that sets an input listed here is a workflow GitHub accepts.`,
    '## Inputs',
    inputTable(source.inputs),
    '## Outputs',
    outputTable(source.outputs),
    ...gateNote(source.outputs),
  ])
}

function inputTable(inputs: ActionInput[]): string {
  const rows = inputs.map(input => [
    code(input.name),
    input.required ? 'yes' : 'no',
    formatDefault(input.default),
    textCell(input.description),
  ])
  return table(['Input', 'Required', 'Default', 'Description'], rows)
}

function outputTable(outputs: ActionOutput[]): string {
  const rows = outputs.map(output => [code(output.name), textCell(output.description)])
  return table(['Output', 'Description'], rows)
}

/**
 * The one part of the action's behaviour that is neither an input nor an output
 * and that costs a reader work if missed: the gate fails the job in a later
 * step, after the translations are committed.
 */
function gateNote(outputs: ActionOutput[]): string[] {
  const gate = outputs.find(output => output.name === 'gate_tripped')
  if (gate === undefined) return []
  return [
    ['::note',
      `A tripped gate does not skip the pull request step. The step that runs `
      + `${code('translate')} records the gate in ${code(`${gate.name}`)} and lets the `
      + `commit happen, and a later step fails the job — so a run that found `
      + `something still keeps the translations it produced.`,
      '::'].join('\n'),
  ]
}

/**
 * A default is rendered as the manifest writes it, workflow expressions
 * included: ${{ github.workspace }} is what the action resolves at run time, and
 * paraphrasing it as "the workspace" would hide which context supplies it.
 */
function formatDefault(value: string | undefined): string {
  if (value === undefined) return '—'
  if (value.length === 0) return code('""')
  return code(cell(value))
}
