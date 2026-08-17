/**
 * Loads the GitHub Action reference's source: the action manifest at the
 * repository root.
 *
 * The manifest is the only declaration of the action's interface — GitHub reads
 * the same file to validate a workflow — so every input's description, required
 * status and default is already machine-readable there. Nothing is restated
 * here; a field this loader cannot find is a field the reference will not claim
 * exists.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { ActionInput, ActionOutput, ActionSource } from '../reference/types.js'

const MANIFEST = new URL('../../../action.yml', import.meta.url)

/** The manifest fields the reference reads, before they are validated. */
interface RawManifest {
  name?: unknown
  description?: unknown
  inputs?: unknown
  outputs?: unknown
}

export async function loadActionSource(): Promise<ActionSource> {
  const raw = parse(await readFile(fileURLToPath(MANIFEST), 'utf-8')) as RawManifest

  return {
    name: text(raw.name, 'name'),
    description: text(raw.description, 'description'),
    inputs: Object.entries(record(raw.inputs, 'inputs')).map(([name, def]) => toInput(name, def)),
    outputs: Object.entries(record(raw.outputs, 'outputs')).map(([name, def]) => toOutput(name, def)),
  }
}

function toInput(name: string, def: Record<string, unknown>): ActionInput {
  return {
    name,
    description: text(def.description, `inputs.${name}.description`),
    // Absent `required` means not required, which is how GitHub reads it too.
    required: def.required === true,
    default: def.default === undefined ? undefined : String(def.default),
  }
}

function toOutput(name: string, def: Record<string, unknown>): ActionOutput {
  return { name, description: text(def.description, `outputs.${name}.description`) }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(malformed(`${field} is not a non-empty string`))
  }
  return value
}

function record(value: unknown, field: string): Record<string, Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(malformed(`${field} is not a mapping`))
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(malformed(`${field}.${key} is not a mapping`))
    }
  }
  return value as Record<string, Record<string, unknown>>
}

function malformed(detail: string): string {
  return `action.yml is not shaped as the reference expects: ${detail}. `
    + 'Fix the manifest, or update docs/generate/sources/action.ts to match its new shape.'
}
