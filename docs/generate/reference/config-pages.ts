/**
 * Renders the configuration field reference: one page listing every field the
 * kit's config schema accepts, plus a table per field whose value is a structure
 * rather than a scalar.
 *
 * It lands in the hand-written configuration section rather than under
 * `9.reference/` with the other generated pages. The route is derived from the
 * file's location, the three concept pages link the field list at
 * `/configuration/reference`, and a reader looking up a field goes to the
 * section they were reading — so the file sits where the route has to be, and
 * the section landing page links it like any other generated reference. The
 * generated notice at the top of the file is what marks it as machine-written,
 * and the shell deletes generated pages it no longer emits by that notice rather
 * than by wiping the directory around it.
 */

import { buildConfigModel, shapedFields } from './config-model.js'
import { GENERATED_NOTICE, cell, code, frontmatter, page, prose, table, textCell } from './markdown.js'
import type {
  ConfigFieldDoc,
  ConfigSource,
  DeclarationSites,
  FormDoc,
  PropertyDoc,
  ReferenceOutput,
  ShapeDoc,
} from './types.js'

/** File under `docs/content`. The numeric prefixes are stripped from the route. */
export const CONFIG_REFERENCE_PATH = '5.configuration/4.reference.md'
/** The route the concept pages link this reference by. */
export const CONFIG_REFERENCE_ROUTE = '/configuration/reference'

const CLI_PACKAGE = '@the-i18n-kit/cli'
const NUXT_PACKAGE = '@the-i18n-kit/nuxt'
const TYPED_CONFIG = 'i18n-kit.config.ts'
const JSON_CONFIG = '.i18n-mcp.json'

/** Table cell for a value the schema does not carry. */
const EMPTY = '—'

/** What the `Declared in` column says, per restriction the model found. */
const SITE_LABELS: Record<DeclarationSites, string> = {
  'both': 'Either config file',
  'json-only': `${code(JSON_CONFIG)} only`,
  'derived-by-nuxt': `Either file; rejected by ${code(NUXT_PACKAGE)}`,
}

export function renderConfigReference(source: ConfigSource): ReferenceOutput {
  const model = buildConfigModel(source)
  const shaped = shapedFields(model.fields)

  return new Map([[CONFIG_REFERENCE_PATH, page([
    frontmatter({
      title: 'Configuration Fields',
      description: 'Every field a kit config file accepts: its type, its constraints, where it may be declared and what it does.',
    }),
    GENERATED_NOTICE,
    `Generated from the zod schema in ${code(CLI_PACKAGE)} that validates your config, so it cannot list a field the tool rejects or omit one it accepts.`,
    '## Where These Fields May Be Declared',
    ...declarationSection(source),
    '## Fields',
    ...fieldsIntro(model.fields, model.strict),
    fieldTable(model.fields, shaped),
    ...shapeSection(shaped),
  ])]])
}

// ---------------------------------------------------------------------------
// Declaration sites
// ---------------------------------------------------------------------------

function declarationSection(source: ConfigSource): string[] {
  return [
    `Two files carry these fields and both validate against this same schema: ${code(TYPED_CONFIG)}, or another accepted extension, and ${code(JSON_CONFIG)}. Unless the ${code('Declared in')} column below says otherwise, a field may be declared in either.`,
    `The ${code('i18nKit')} block in ${code('nuxt.config.ts')} is not a third place for them. ${code(NUXT_PACKAGE)} accepts its own module options there — ${names(source.nuxtModuleOptions)} — and reads no field on this page from it. The CLI reads what that module publishes from a build artifact, so a field declared beside your Nuxt config applied to nothing until something had been built, and a pipeline that installs the CLI and runs it against a checkout never builds.`,
    restrictionTable(source),
  ]
}

function restrictionTable(source: ConfigSource): string {
  const rows = [
    [
      SITE_LABELS['json-only'],
      names(source.untypedKeys),
      `The schema accepts the key at runtime and the typed config's ${code('ProjectConfig')} interface leaves it out, so declaring it in ${code(TYPED_CONFIG)} is a type error in your editor.`,
    ],
    [
      SITE_LABELS['derived-by-nuxt'],
      names(source.moduleOwnedKeys),
      `Either file accepts the key, and in a Nuxt project running ${code(NUXT_PACKAGE)} it fails the build: Nuxt resolves these itself, and a hand-written second copy is a source of truth with no tiebreak.`,
    ],
  ]
  return table(['Restriction', 'Applies to', 'Means'], rows)
}

function names(values: readonly string[]): string {
  return values.map(value => code(value)).join(', ')
}

// ---------------------------------------------------------------------------
// The field table
// ---------------------------------------------------------------------------

function fieldsIntro(fields: ConfigFieldDoc[], strict: boolean): string[] {
  const optional = fields.every(field => !field.required)
  return [
    [
      optional ? 'Every field is optional.' : '',
      strict
        ? `The schema is strict, so a key it does not declare fails validation rather than being ignored — a misspelled field stops the command that read it.`
        : '',
    ].filter(Boolean).join(' '),
    ...deprecationNote(fields),
  ]
}

function deprecationNote(fields: ConfigFieldDoc[]): string[] {
  if (!fields.some(field => field.deprecated)) return []
  return [
    `A field marked deprecated still validates, so a config that has one keeps loading. Every loader strips it after validation and warns, naming the file it came from, so the value is accepted and then means nothing.`,
  ]
}

function fieldTable(fields: ConfigFieldDoc[], shaped: ConfigFieldDoc[]): string {
  const linked = new Set(shaped.map(field => field.name))
  const rows = fields.map(field => [
    fieldName(field, linked.has(field.name)),
    code(cell(field.type)),
    constraints(field),
    SITE_LABELS[field.sites],
    description(field.description),
  ])
  return table(['Field', 'Type', 'Constraints', 'Declared in', 'Description'], rows)
}

function fieldName(field: ConfigFieldDoc, linked: boolean): string {
  const name = linked ? `[${code(field.name)}](#${anchor(field.name)})` : code(field.name)
  return field.deprecated ? `${name} (deprecated)` : name
}

function constraints(field: { constraints: string[] }): string {
  return field.constraints.length === 0 ? EMPTY : textCell(field.constraints.join('; '))
}

/** A description the schema does not declare leaves a cell that reads as unfinished. */
function description(text: string): string {
  return text === '' ? EMPTY : textCell(text)
}

/** The heading id Nuxt Content derives from a heading whose text is the field name. */
function anchor(name: string): string {
  return name.toLowerCase()
}

// ---------------------------------------------------------------------------
// Nested shapes
// ---------------------------------------------------------------------------

function shapeSection(shaped: ConfigFieldDoc[]): string[] {
  if (shaped.length === 0) return []
  return [
    '## Nested Shapes',
    'These fields take a structure rather than a single value. The tables state what the structure holds; the descriptions are the schema\'s own.',
    ...shaped.flatMap(field => fieldShape(field, field.shape as ShapeDoc)),
  ]
}

function fieldShape(field: ConfigFieldDoc, shape: ShapeDoc): string[] {
  const subject = shape.scope === 'entry' ? 'Each entry' : 'The value'
  return [
    `### ${code(field.name)}`,
    ...intro(subject, shape),
    ...(shape.properties.length > 0 ? [propertyTable(shape.properties)] : []),
    ...(shape.forms.length > 0 ? [formTable(shape.forms)] : []),
    ...shape.forms.flatMap(formProperties),
    ...openNote(shape),
  ]
}

function intro(subject: string, shape: ShapeDoc): string[] {
  if (shape.entryDescription !== undefined) return [`${subject}: ${prose(shape.entryDescription)}`]
  if (shape.forms.length > 0) return [`${subject} takes one of these forms:`]
  return [`${subject} is an object:`]
}

/** A union member that is an object carries its properties in a table of its own. */
function formProperties(form: FormDoc): string[] {
  if (form.properties.length === 0) return []
  return [`The ${code(form.type)} form holds:`, propertyTable(form.properties)]
}

function propertyTable(properties: PropertyDoc[]): string {
  const rows = properties.map(property => [
    code(property.name),
    code(cell(property.type)),
    property.required ? 'yes' : 'no',
    constraints(property),
    description(property.description),
  ])
  return table(['Property', 'Type', 'Required', 'Constraints', 'Description'], rows)
}

function formTable(forms: FormDoc[]): string {
  const rows = forms.map(form => [
    code(cell(form.type)),
    constraints(form),
    description(form.description),
  ])
  return table(['Type', 'Constraints', 'Description'], rows)
}

function openNote(shape: ShapeDoc): string[] {
  if (!shape.open) return []
  return [
    'Properties beyond these are accepted rather than rejected, so a key from an older version of the kit does not fail your config. Anything the current schema does not list is ignored.',
  ]
}
