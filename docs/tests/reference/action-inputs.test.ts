/**
 * Contract tests for the GitHub Action reference against `action.yml`.
 *
 * The manifest is parsed twice: once through the loader the generator uses, and
 * once directly here, so a loader that silently dropped an input fails as well
 * as a page that did. There is no per-input list in this file, which is the
 * point — an input added to the manifest cannot go undocumented.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildReference } from '../../generate/reference/build.js'
import { loadActionSource } from '../../generate/sources/action.js'
import { fixtureSources } from './fixtures.js'
import { actionPage, rowNames, section, tableRow } from './helpers.js'

const MANIFEST = new URL('../../../action.yml', import.meta.url)

const source = await loadActionSource()
const page = actionPage(buildReference(fixtureSources({ action: source })))

const manifest = parse(await readFile(fileURLToPath(MANIFEST), 'utf-8')) as {
  inputs: Record<string, { description: string, required?: boolean, default?: unknown }>
  outputs: Record<string, { description: string }>
}

describe('the GitHub Action reference against action.yml', () => {
  it('reads the inputs and outputs the manifest declares', () => {
    // Guards the loader itself: an empty source satisfies every assertion below.
    expect(source.inputs.map(input => input.name)).toEqual(Object.keys(manifest.inputs))
    expect(source.outputs.map(output => output.name)).toEqual(Object.keys(manifest.outputs))
  })

  it('documents every input with the required status the manifest declares', () => {
    const inputs = section(page, '## Inputs')
    expect([...rowNames(inputs)].sort()).toEqual(Object.keys(manifest.inputs).sort())

    for (const [name, declared] of Object.entries(manifest.inputs)) {
      expect(tableRow(inputs, name)).toContain(declared.required === true ? 'yes' : 'no')
    }
  })

  it('documents every declared default, and says so where there is none', () => {
    const inputs = section(page, '## Inputs')
    for (const [name, declared] of Object.entries(manifest.inputs)) {
      const row = tableRow(inputs, name)
      if (declared.default === undefined) {
        expect(row, name).toContain('—')
        continue
      }
      expect(row, name).toContain(`\`${String(declared.default)}\``)
    }
  })

  it('carries every input description onto the page verbatim', () => {
    for (const [name, declared] of Object.entries(manifest.inputs)) {
      // Angle brackets are entity-escaped: a markdown renderer reads
      // `<timestamp>` as an opening tag and swallows the rest of the sentence.
      expect(page, name).toContain(escapeAngles(declared.description))
    }
  })

  it('documents every output with its description', () => {
    const outputs = section(page, '## Outputs')
    expect([...rowNames(outputs)].sort()).toEqual(Object.keys(manifest.outputs).sort())

    for (const [name, declared] of Object.entries(manifest.outputs)) {
      expect(outputs, name).toContain(escapeAngles(declared.description))
    }
  })

  it('describes what the action runs by linking the command reference', () => {
    // The action installs the CLI and runs `translate`; its flags and exit codes
    // are documented there rather than restated here.
    expect(page).toContain('(/reference/cli/translate)')
    expect(page).toContain('(/reference/cli#exit-codes)')
  })
})

function escapeAngles(value: string): string {
  return value.replace(/</g, '&lt;')
}
