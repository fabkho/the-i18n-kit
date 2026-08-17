/**
 * Turns the published JSON Schema into the model the configuration pages render
 * from.
 *
 * Everything is read off the schema node — type, optionality, constraints,
 * description, deprecation, nested shape — so a field added to the zod schema
 * arrives here with no edit in this directory. The one thing the schema cannot
 * answer is where a field may be declared, which comes from the declarations the
 * loader reads out of the packages that enforce it.
 */

import type {
  ConfigFieldDoc,
  ConfigSource,
  DeclarationSites,
  FormDoc,
  JsonSchemaNode,
  PropertyDoc,
  ShapeDoc,
} from './types.js'

export interface ConfigModel {
  /** One per schema property, in the order the schema declares them. */
  fields: ConfigFieldDoc[]
  /** True when the schema rejects a property it does not declare. */
  strict: boolean
}

export function buildConfigModel(source: ConfigSource): ConfigModel {
  const required = new Set(source.schema.required ?? [])
  const moduleOwned = new Set(source.moduleOwnedKeys)
  const untyped = new Set(source.untypedKeys)

  const fields = Object.entries(source.schema.properties).map(([name, node]) => ({
    name,
    type: typeOf(node),
    required: required.has(name),
    constraints: constraintsOf(node),
    description: node.description ?? '',
    deprecated: node.deprecated === true,
    sites: sitesFor(name, moduleOwned, untyped),
    shape: shapeOf(node),
  }))

  return { fields, strict: source.schema.additionalProperties === false }
}

/** The fields whose inner shape needs a table of its own. */
export function shapedFields(fields: ConfigFieldDoc[]): ConfigFieldDoc[] {
  return fields.filter(field => field.shape !== undefined)
}

/**
 * Where a field may be declared.
 *
 * Both hand-written files validate against one schema, so accepting every field
 * is the rule and each departure from it comes from a declaration elsewhere: the
 * keys the Nuxt module derives, and the keys the typed config's interface leaves
 * out.
 */
function sitesFor(
  name: string,
  moduleOwned: Set<string>,
  untyped: Set<string>,
): DeclarationSites {
  if (moduleOwned.has(name)) return 'derived-by-nuxt'
  if (untyped.has(name)) return 'json-only'
  return 'both'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A field's type, in the notation a reader writing the value would use.
 *
 * An accepted value set wins over the declared type — `"json" | "php-array"`
 * over `string` — because it is what the reader has to type. `unknown` for a node
 * with no type at all is the honest rendering of `z.unknown()`, which is what the
 * schema uses for a field it accepts without reading.
 */
function typeOf(node: JsonSchemaNode): string {
  return acceptedValues(node) ?? containerType(node) ?? scalarType(node)
}

/** The values a node accepts, where it accepts a set of them rather than a type. */
function acceptedValues(node: JsonSchemaNode): string | undefined {
  if (node.anyOf !== undefined) return node.anyOf.map(typeOf).join(' | ')
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (node.enum !== undefined) return node.enum.map(value => JSON.stringify(value)).join(' | ')
  return undefined
}

/** An array or an object, whose notation carries the type of what it holds. */
function containerType(node: JsonSchemaNode): string | undefined {
  if (node.type === 'array') return `${parenthesize(typeOf(node.items ?? {}))}[]`
  if (node.type !== 'object') return undefined

  const value = recordValue(node)
  return value === undefined ? 'object' : `Record<string, ${typeOf(value)}>`
}

function scalarType(node: JsonSchemaNode): string {
  if (Array.isArray(node.type)) return node.type.join(' | ')
  return node.type ?? 'unknown'
}

/** A union inside an array notation needs grouping: `(string | object)[]`. */
function parenthesize(type: string): string {
  return type.includes(' | ') ? `(${type})` : type
}

/**
 * The value schema of a record — an object that lists no properties and gives a
 * schema for every property instead.
 */
function recordValue(node: JsonSchemaNode): JsonSchemaNode | undefined {
  if (node.properties !== undefined) return undefined
  const additional = node.additionalProperties
  return typeof additional === 'object' ? additional : undefined
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

/**
 * What the schema rejects beyond the type, for the field and for its entries.
 *
 * Entry constraints are prefixed rather than merged: `locales` accepts any
 * number of entries and constrains each one, and a reader who reads
 * "minimum length 1" against the array itself would think an empty array fails.
 */
function constraintsOf(node: JsonSchemaNode): string[] {
  const entry = node.items === undefined
    ? []
    : ownConstraints(node.items).map(constraint => `each entry: ${constraint}`)
  return [...ownConstraints(node), ...entry]
}

/**
 * An accepted value set is already in the type — `"json" | "php-array"` says
 * more than "one of json, php-array" beside it — so only what the type cannot
 * carry appears here.
 */
function ownConstraints(node: JsonSchemaNode): string[] {
  const constraints: string[] = []
  if (node.minLength !== undefined) constraints.push(`minimum length ${node.minLength}`)
  // Suggestions, not a constraint: the schema leaves `framework` open because
  // adapters are a runtime registry, and rendering these as accepted values
  // would document a restriction the tool does not enforce.
  if (node.examples !== undefined) {
    const values = node.examples.map(value => JSON.stringify(value)).join(', ')
    constraints.push(`suggested: ${values}`)
  }
  return constraints
}

// ---------------------------------------------------------------------------
// Nested shapes
// ---------------------------------------------------------------------------

/**
 * The shape inside a field, or undefined when the type string says all of it.
 *
 * One level of unwrapping: for an array or a record the shape belongs to each
 * entry, for anything else to the field itself. `Record<string, string>` needs
 * nothing further, and gets nothing — the check is whether the target carries
 * properties, alternative forms or a description of its own.
 */
function shapeOf(node: JsonSchemaNode): ShapeDoc | undefined {
  const entry = node.items ?? recordValue(node)
  const target = entry ?? node
  const shape: ShapeDoc = {
    scope: entry === undefined ? 'field' : 'entry',
    properties: propertyDocs(target),
    forms: formDocs(target),
    open: target.properties !== undefined && target.additionalProperties !== false,
    entryDescription: entry?.description,
  }

  const empty = shape.properties.length === 0
    && shape.forms.length === 0
    && shape.entryDescription === undefined
  return empty ? undefined : shape
}

function propertyDocs(node: JsonSchemaNode): PropertyDoc[] {
  const required = new Set(node.required ?? [])
  return Object.entries(node.properties ?? {}).map(([name, property]) => ({
    name,
    type: typeOf(property),
    required: required.has(name),
    constraints: constraintsOf(property),
    description: property.description ?? '',
  }))
}

/**
 * A union's members, each with its own properties where it is an object.
 *
 * `localeDirs` accepts a path string or a `{ path, layer }` object, and the two
 * properties of that object are described nowhere else — a union rendered as
 * `string | object` with nothing under it documents half the field.
 */
function formDocs(node: JsonSchemaNode): FormDoc[] {
  return (node.anyOf ?? []).map(form => ({
    type: typeOf(form),
    constraints: constraintsOf(form),
    description: form.description ?? '',
    properties: propertyDocs(form),
  }))
}
