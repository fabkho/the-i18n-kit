import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { clearConfigCache } from 'the-i18n-cli'

/**
 * Transport-level tests: a linked client/server pair over the SDK's in-memory
 * transport, against a real temp project resolved by the CLI's generic
 * adapter. The client declares no sampling capability — the same situation as
 * Claude Code and most MCP hosts.
 */

let projectDir: string
let client: Client

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ type: string, text: string }>)[0]?.text ?? ''
  return { result, json: result.isError ? undefined : JSON.parse(text) as Record<string, any>, text }
}

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'i18n-mcp-test-'))
  const localesDir = join(projectDir, 'i18n', 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(projectDir, '.i18n-mcp.json'), JSON.stringify({
    localeDirs: [{ path: 'i18n/locales', layer: 'root' }],
    defaultLocale: 'de',
    locales: ['de', 'en'],
  }))
  await writeFile(join(localesDir, 'de.json'), JSON.stringify({
    greeting: 'Hallo {name}',
    actions: { save: 'Speichern' },
  }))
  await writeFile(join(localesDir, 'en.json'), '{}\n')

  // The server captures its default project dir from the environment at
  // module load — set it before importing so resources can self-resolve.
  process.env.I18N_PROJECT_DIR = projectDir
  const { createServer } = await import('../src/server.js')
  const server = createServer()
  client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
})

afterAll(async () => {
  await client.close()
  await rm(projectDir, { recursive: true, force: true })
})

describe('the-i18n-mcp server over in-memory transport', () => {
  it('lists all registered tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name).sort()

    expect(names).toEqual([
      'discover',
      'find_orphan_keys',
      'get_missing_translations',
      'get_translations',
      'list_namespaces',
      'remove_orphan_keys',
      'remove_translations',
      'rename_translation_key',
      'scaffold_locale',
      'search_translations',
      'translate_key',
      'translate_missing',
      'write_translations',
    ])
  })

  it('reads a locale resource with a cold cache — no prior discover call', async () => {
    clearConfigCache()
    const result = await client.readResource({ uri: 'i18n:///root/de' })
    const content = result.contents[0] as { text: string }
    expect(JSON.parse(content.text)).toMatchObject({ greeting: 'Hallo {name}' })
  })

  it('discover returns the project configuration', async () => {
    const { json } = await callTool('discover', { projectDir })

    expect(json?.defaultLocale).toBe('de')
    expect(json?.locales).toEqual([
      expect.objectContaining({ code: 'de' }),
      expect.objectContaining({ code: 'en' }),
    ])
    expect(json?.layers).toEqual([
      expect.objectContaining({ layer: 'root' }),
    ])
  })

  it('translate_missing without sampling capability returns fallback contexts', async () => {
    const { json } = await callTool('translate_missing', { layer: 'root', projectDir })

    expect(json?.summary.samplingSupported).toBe(false)
    expect(json?.summary.message).toContain('write_translations')
    expect(json?.fallbackContexts?.en?.keysToTranslate).toMatchObject({
      'greeting': 'Hallo {name}',
      'actions.save': 'Speichern',
    })
  })

  it('translate_missing keeps fallback contexts in compact mode', async () => {
    const { json } = await callTool('translate_missing', { layer: 'root', compact: true, projectDir })

    expect(json?.fallbackContexts?.en).toBeDefined()
    expect(json?.summary.message).toContain('write_translations')
    expect(json?.summary.byLocale).toEqual([
      expect.objectContaining({ locale: 'en', reason: 'sampling-unavailable' }),
    ])
    expect(json?.results).toBeUndefined()
  })

  it('rejects invalid tool input via schema validation', async () => {
    const { result } = await callTool('write_translations', {
      layer: 'root',
      // invalid: values must be locale maps, not plain strings
      translations: { 'some.key': 'plain string' },
      projectDir,
    })

    expect(result.isError).toBe(true)
  })

  it('reports tool-level errors as MCP error responses', async () => {
    const { result, text } = await callTool('get_translations', {
      layer: 'no-such-layer',
      locale: 'de',
      keys: ['greeting'],
      projectDir,
    })

    expect(result.isError).toBe(true)
    expect(text).toContain('no-such-layer')
  })
})
