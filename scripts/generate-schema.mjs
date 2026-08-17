#!/usr/bin/env node
/**
 * Write `packages/mcp/schema.json` from the CLI's zod config schema.
 *
 * The published schema is generated rather than hand-maintained so it cannot
 * disagree with the schema that actually validates config (#346). Run this
 * after changing `packages/cli/src/config/schema.ts`:
 *
 *   pnpm generate:schema
 *
 * The source is loaded through jiti rather than the built `dist`, so the
 * generator works on a clean checkout without a build step. A test in the CLI
 * package fails if the committed file drifts from the schema.
 *
 * Usage: node scripts/generate-schema.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const cliPackage = new URL('../packages/cli/package.json', import.meta.url)
const schemaSource = new URL('../packages/cli/src/config/schema-json.ts', import.meta.url)
const target = new URL('../packages/mcp/schema.json', import.meta.url)

// jiti is a dependency of the CLI package, so resolve it from there.
const { createJiti } = await import(createRequire(cliPackage).resolve('jiti'))
const jiti = createJiti(import.meta.url)
const { renderConfigJsonSchema } = await jiti.import(schemaSource.pathname)

const generated = renderConfigJsonSchema()

if (process.argv.includes('--check')) {
  const committed = readFileSync(target, 'utf-8')
  if (committed !== generated) {
    console.error('packages/mcp/schema.json is out of date — run `pnpm generate:schema`.')
    process.exit(1)
  }
  console.log('packages/mcp/schema.json is up to date.')
}
else {
  writeFileSync(target, generated)
  console.log('Wrote packages/mcp/schema.json.')
}
