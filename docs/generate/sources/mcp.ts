/**
 * Loads the MCP reference's source: the tool listing the server advertises.
 *
 * The server is started as a child process over stdio and asked for
 * `tools/list`, the same request an MCP host makes on connect. That is the point
 * of doing it this way rather than reading the zod schemas in
 * `@the-i18n-kit/mcp`: the reference then documents what a host is handed,
 * including the JSON Schema the protocol converts those definitions into, and a
 * tool that stops being registered stops being documented without anyone
 * noticing the difference.
 *
 * The built entry point is used because that is what the `bin` field points at
 * and what a host runs. `pnpm build` therefore has to precede
 * `pnpm docs:generate`; the CI workflow builds the packages for this reason,
 * and a missing build fails here with that instruction rather than an
 * unresolved import.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { McpSource, McpToolListing } from '../reference/types.js'

/**
 * The compiled server entry, which is what `the-i18n-mcp` runs. Content-hashed
 * chunks sit beside it, so the entry is addressed directly rather than through
 * the package name.
 */
const SERVER_ENTRY = new URL('../../../packages/mcp/dist/index.js', import.meta.url)

/**
 * Environment variables that put the server in provider mode.
 *
 * Stripped so the listing does not depend on whose machine generated it. The
 * tool set is registered unconditionally today, but a reference that silently
 * changed with a developer's shell would be worse than one that refuses to.
 */
const PROVIDER_ENV = ['I18N_PROVIDER', 'I18N_MODEL', 'I18N_BASE_URL']

export async function loadMcpSource(): Promise<McpSource> {
  const entry = fileURLToPath(SERVER_ENTRY)
  if (!existsSync(entry)) {
    throw new Error(
      `The MCP server build is missing at ${entry}. The tool reference is generated from `
      + 'the listing the built server advertises over stdio — run `pnpm build` before '
      + '`pnpm docs:generate`.',
    )
  }

  const client = new Client({ name: 'the-i18n-kit-docs', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: cleanEnv(),
  }))

  try {
    const { tools } = await client.listTools()
    return { tools: tools as unknown as McpToolListing[] }
  }
  finally {
    await client.close()
  }
}

function cleanEnv(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !PROVIDER_ENV.includes(entry[0]),
  )
  return Object.fromEntries(entries)
}
