/**
 * Loads the configuration reference's sources.
 *
 * The field text comes from the JSON Schema `packages/cli/src/config/schema-json.ts`
 * renders, which `z.toJSONSchema()` produces from the same zod schema that
 * validates every config file. That is one derivation of one definition, not a
 * second copy: a field, its type, its constraints and its `.describe()` text
 * reach this reference only by being in the schema that accepts them.
 *
 * Reading the JSON Schema rather than walking zod internals keeps the builder on
 * plain data — no `_def` traversal that a zod minor release can rename, and a
 * fixture that is a JSON literal.
 *
 * Three facts the schema cannot state come from the files that own them, read as
 * text for the same reason `./cli.ts` reads the hidden-command set: each is a
 * module-private declaration, and the alternative is a hand-written copy in the
 * docs that nothing checks.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderConfigJsonSchema } from '../../../packages/cli/src/config/schema-json.js'
import type { ConfigJsonSchema, ConfigSource } from '../reference/types.js'

const SCHEMA_MODULE = new URL('../../../packages/cli/src/config/schema.ts', import.meta.url)
const NUXT_VALIDATE = new URL('../../../packages/nuxt/src/validate.ts', import.meta.url)
const NUXT_MODULE = new URL('../../../packages/nuxt/src/module.ts', import.meta.url)

/** A single-quoted string in a matched declaration, e.g. a `['a', 'b']` list. */
const QUOTED = /'([^']+)'/g
/** An optional property of a TypeScript interface, e.g. `enabled?: boolean`. */
const OPTIONAL_PROPERTY = /^\s*(\w+)\?:/gm

export async function loadConfigSource(): Promise<ConfigSource> {
  const [moduleOwnedKeys, untypedKeys, nuxtModuleOptions] = await Promise.all([
    scrape(
      NUXT_VALIDATE,
      /const MODULE_OWNED_KEYS = \[([^\]]*)\]/,
      QUOTED,
      'the MODULE_OWNED_KEYS declaration',
      'which fields @the-i18n-kit/nuxt rejects in a hand-written config',
    ),
    scrape(
      SCHEMA_MODULE,
      /type SchemaKey = Exclude<[^,]+,([^>]*)>/,
      QUOTED,
      'the SchemaKey drift-guard declaration',
      'which schema fields are absent from the typed config interface',
    ),
    scrape(
      NUXT_MODULE,
      /export interface ModuleOptions \{([\s\S]*?)\n\}/,
      OPTIONAL_PROPERTY,
      'the ModuleOptions interface',
      'what the i18nKit block in nuxt.config.ts accepts',
    ),
  ])

  return {
    schema: JSON.parse(renderConfigJsonSchema()) as ConfigJsonSchema,
    moduleOwnedKeys,
    untypedKeys,
    nuxtModuleOptions,
  }
}

/**
 * Read a list out of a module's source text.
 *
 * Throws rather than returning nothing: an empty list renders a page that states
 * no restriction applies to any field, which is a wrong reference that generates
 * successfully. Failing here names the file to fix instead.
 */
async function scrape(
  url: URL,
  block: RegExp,
  item: RegExp,
  what: string,
  documents: string,
): Promise<string[]> {
  const path = fileURLToPath(url)
  const source = await readFile(path, 'utf-8')
  const declaration = block.exec(source)?.[1]
  const names = declaration === undefined
    ? []
    : [...declaration.matchAll(item)].map(match => match[1] as string)

  if (names.length === 0) {
    throw new Error(
      `Could not read ${what} from ${path}. The configuration reference derives `
      + `${documents} from it — update the pattern in docs/generate/sources/config.ts `
      + 'to match the new shape.',
    )
  }
  return names
}
