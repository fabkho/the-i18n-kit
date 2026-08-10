/**
 * Child-process integration: the compiled dist/index.js served through
 * serveStdio, driven over real stdio pipes. Pins the production entry point
 * (shebang, transport wiring, per-connection era pinning) that the
 * in-process transport tests cannot reach.
 *
 * The nuxt-i18n-mcp bin alias points at the same dist/index.js and is not
 * spawned separately.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const distEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url))

let projectDir: string

function spawnParams() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) =>
      v !== undefined && !['I18N_PROVIDER', 'I18N_MODEL'].includes(k)),
  ) as Record<string, string>
  return {
    command: process.execPath,
    args: [distEntry],
    env: { ...env, I18N_PROJECT_DIR: projectDir },
  }
}

beforeAll(async () => {
  if (!existsSync(distEntry)) {
    throw new Error('dist/index.js missing — run `pnpm --filter the-i18n-mcp build` first')
  }
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-mcp-stdio-'))
  const localesDir = join(projectDir, 'i18n', 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(projectDir, '.i18n-mcp.json'), JSON.stringify({
    localeDirs: [{ path: 'i18n/locales', layer: 'root' }],
    defaultLocale: 'de',
    locales: ['de', 'en'],
  }))
  await writeFile(join(localesDir, 'de.json'), JSON.stringify({ greeting: 'Hallo' }))
  await writeFile(join(localesDir, 'en.json'), '{}\n')
})

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true })
})

describe('the-i18n-mcp over a spawned stdio process', () => {
  it('serves a legacy client end to end', async () => {
    const client = new Client({ name: 'stdio-legacy', version: '0.0.0' })
    await client.connect(new StdioClientTransport(spawnParams()))
    try {
      expect(client.getProtocolEra()).toBe('legacy')

      const { tools } = await client.listTools()
      expect(tools.map(t => t.name)).toContain('translate_missing')

      const result = await client.callTool({ name: 'discover', arguments: { projectDir } })
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
      expect(JSON.parse(text).defaultLocale).toBe('de')
    } finally {
      await client.close()
    }
  })

  // Issue #264 repro: I18N_PROJECT_DIR alone must be enough — tools must not
  // fall back to the server process cwd when projectDir is omitted.
  it('answers discover without a projectDir argument via I18N_PROJECT_DIR', async () => {
    const client = new Client({ name: 'stdio-env-dir', version: '0.0.0' })
    await client.connect(new StdioClientTransport(spawnParams()))
    try {
      const result = await client.callTool({ name: 'discover', arguments: {} })
      expect(result.isError).toBeFalsy()

      const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
      const json = JSON.parse(text) as { defaultLocale: string, layers: Array<{ layer: string }> }
      expect(json.defaultLocale).toBe('de')
      expect(json.layers).toEqual([expect.objectContaining({ layer: 'root' })])
    } finally {
      await client.close()
    }
  })

  it('negotiates the modern era against the same entry', async () => {
    const client = new Client(
      { name: 'stdio-modern', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    )
    await client.connect(new StdioClientTransport(spawnParams()))
    try {
      expect(client.getProtocolEra()).toBe('modern')

      const { tools } = await client.listTools()
      expect(tools.map(t => t.name)).toContain('discover')
    } finally {
      await client.close()
    }
  })
})
