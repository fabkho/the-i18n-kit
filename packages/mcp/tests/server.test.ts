import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createMcpHandler, InMemoryTransport } from '@modelcontextprotocol/server'
import type { McpHttpHandler, McpServer } from '@modelcontextprotocol/server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { clearConfigCache } from 'the-i18n-cli'
import type { TranslateFn } from 'the-i18n-cli'

/**
 * Transport-level tests: a linked client/server pair over the SDK's in-memory
 * transport, against a real temp project resolved by the CLI's generic
 * adapter. Covers both translation modes: agent (no backend configured) and
 * provider (a TranslateFn injected through the test-only createServer seam).
 *
 * Dual-era coverage drives createMcpHandler in-process through its fetch
 * function (the SDK's documented no-socket seam for 2026-07-28 behavior);
 * InMemoryTransport pairs connect 2025-era instances only. The production
 * stdio entry (serveStdio) pins the era per connection from the same
 * createServer factory exercised here.
 */

let projectDir: string
let client: Client

async function makeProject(extraConfig: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'i18n-mcp-test-'))
  const localesDir = join(dir, 'i18n', 'locales')
  await mkdir(localesDir, { recursive: true })
  await writeFile(join(dir, '.i18n-mcp.json'), JSON.stringify({
    localeDirs: [{ path: 'i18n/locales', layer: 'root' }],
    defaultLocale: 'de',
    locales: ['de', 'en'],
    ...extraConfig,
  }))
  await writeFile(join(localesDir, 'de.json'), JSON.stringify({
    greeting: 'Hallo {name}',
    actions: { save: 'Speichern' },
  }))
  await writeFile(join(localesDir, 'en.json'), '{}\n')
  return dir
}

async function connectClient(server: McpServer): Promise<Client> {
  const c = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    c.connect(clientTransport),
  ])
  return c
}

async function callToolOn(c: Client, name: string, args: Record<string, unknown>) {
  const result = await c.callTool({ name, arguments: args })
  const text = (result.content as Array<{ type: string, text: string }>)[0]?.text ?? ''
  return { result, json: result.isError ? undefined : JSON.parse(text) as Record<string, any>, text }
}

async function callTool(name: string, args: Record<string, unknown>) {
  return callToolOn(client, name, args)
}

/** A well-behaved fake backend: translates every key in the request batch. */
const fakeTranslateFn: TranslateFn = async ({ userMessage }) => {
  const line = userMessage.split('\n').find(l => l.trimStart().startsWith('{"'))
  if (!line) throw new Error(`No batch JSON found in user message:\n${userMessage}`)
  const batch = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)) as Record<string, string>
  const out = Object.fromEntries(Object.entries(batch).map(([k, v]) => [k, `[t] ${v}`]))
  return { text: JSON.stringify(out), model: 'fake-model' }
}

beforeAll(async () => {
  projectDir = await makeProject()

  // Guard against provider config leaking in from the host environment —
  // this file's default client must run in agent mode.
  delete process.env.I18N_PROVIDER
  delete process.env.I18N_MODEL

  // The server captures its default project dir from the environment at
  // module load — set it before importing so resources can self-resolve.
  process.env.I18N_PROJECT_DIR = projectDir
  const { createServer } = await import('../src/server.js')
  client = await connectClient(await createServer())
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
      'find_duplicate_keys',
      'find_orphan_keys',
      'find_undefined_keys',
      'get_missing_translations',
      'get_translation_status',
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

  it('exposes no sampling wording in the translate tool descriptions', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description?.toLowerCase()).not.toContain('sampling')
      expect(tool.description?.toLowerCase()).not.toContain('host llm')
    }
  })

  it('reads a locale resource with a cold cache — no prior discover call', async () => {
    clearConfigCache()
    const result = await client.readResource({ uri: 'i18n:///root/de' })
    const content = result.contents[0] as { text: string }
    expect(JSON.parse(content.text)).toMatchObject({ greeting: 'Hallo {name}' })
  })

  it('discover returns the project configuration and the agent translation mode', async () => {
    const { json } = await callTool('discover', { projectDir })

    expect(json?.defaultLocale).toBe('de')
    expect(json?.locales).toEqual([
      expect.objectContaining({ code: 'de' }),
      expect.objectContaining({ code: 'en' }),
    ])
    expect(json?.layers).toEqual([
      expect.objectContaining({ layer: 'root' }),
    ])
    expect(json?.translationMode).toBe('agent')
    expect(json?.translationProvider).toBeUndefined()
    expect(json?.translationModel).toBeUndefined()
    expect(json?.protectedLocales).toEqual([])
  })

  it('discover without a projectDir argument defaults to I18N_PROJECT_DIR', async () => {
    // Tools must honor the env default, not the test process cwd (issue #264).
    const { result, json } = await callTool('discover', {})

    expect(result.isError).toBeFalsy()
    expect(json?.defaultLocale).toBe('de')
    expect(json?.layers).toEqual([
      expect.objectContaining({ layer: 'root' }),
    ])
  })

  it('discover surfaces protectedLocales resolved to canonical codes', async () => {
    // Refs may use any accepted form (here a file name and an unknown entry);
    // discover resolves them to canonical codes and drops unknown entries.
    const dir = await makeProject({ protectedLocales: ['en.json', 'xx-nope'] })
    try {
      const { json } = await callTool('discover', { projectDir: dir })

      expect(json?.protectedLocales).toEqual(['en'])
      // The raw config refs remain visible under projectConfig.
      expect(json?.projectConfig?.protectedLocales).toEqual(['en.json', 'xx-nope'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('translate_missing without a translation backend returns fallback contexts', async () => {
    const { json } = await callTool('translate_missing', { layer: 'root', projectDir })

    expect(json?.summary.mode).toBe('agent')
    expect(json?.summary.totalSkipped).toBe(2)
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
      expect.objectContaining({ locale: 'en', mode: 'agent', missing: 2, skipped: 2 }),
    ])
    expect(json?.results).toBeUndefined()
  })

  // #301: stderr is the server's own log, so an MCP caller can only learn
  // that a locale ref was dropped if the result itself says so.
  it('write_translations reports an unresolvable locale ref in the result', async () => {
    const { json } = await callTool('write_translations', {
      projectDir,
      layer: 'root',
      translations: { 'actions.cancel': { de: 'Abbrechen', 'de-DE-formal': 'Brechen Sie ab' } },
    })

    expect(json?.unresolvedLocales).toEqual([
      expect.objectContaining({ ref: 'de-DE-formal', keys: ['actions.cancel'] }),
    ])
    // The trap this guards: the key IS written, for the locale that resolved.
    expect(json?.written).toContain('actions.cancel')
    expect(json?.filesWritten).toBe(1)
  })

  it('write_translations leaves the result shape untouched when every ref resolves', async () => {
    const { json } = await callTool('write_translations', {
      projectDir,
      layer: 'root',
      translations: { 'actions.close': { de: 'Schliessen', en: 'Close' } },
    })

    expect(json).not.toHaveProperty('unresolvedLocales')
    expect(json).not.toHaveProperty('ambiguousLocales')
    expect(json?.filesWritten).toBe(2)
  })

  it('get_translation_status reports coverage in one call', async () => {
    const { json } = await callTool('get_translation_status', { projectDir })

    // The fixture has de fully populated and en empty, so en is 0%.
    expect(json?.summary.completionPercent).toBeDefined()
    expect(json?.summary.referenceLocale.code).toBe('de')
    expect(json?.locales).toBeDefined()
    expect(json?.layers).toBeDefined()
  })

  it('get_translation_status marks protected locales as excluded', async () => {
    const dir = await makeProject({ protectedLocales: ['en'] })
    const { json } = await callTool('get_translation_status', { projectDir: dir })

    expect(json?.summary.protectedLocales).toEqual(['en'])
    expect(json?.locales?.[0]).toMatchObject({ code: 'en', excludedFromOverall: true })
    await rm(dir, { recursive: true, force: true })
  })

  it('find_duplicate_keys returns a valid empty result for a single-layer project', async () => {
    const { json } = await callTool('find_duplicate_keys', { projectDir })

    // One app, one layer — no (shared, child) pairs exist to check.
    expect(json?.collisions).toEqual([])
    expect(json?.summary.totalCollisions).toBe(0)
    expect(json?.summary.divergentCount).toBe(0)
    expect(json?.summary.pairsChecked).toBe(0)
    expect(json?.summary.locale).toBe('de')
    expect(json?.summary.message).toBeDefined()
    expect(json?.guidance).toBeDefined()
  })

  it('find_undefined_keys returns a clean result for a project without code usage', async () => {
    const { json } = await callTool('find_undefined_keys', { projectDir })

    expect(json?.undefinedKeys).toEqual([])
    expect(json?.uncertainKeys).toEqual([])
    expect(json?.summary.undefinedCount).toBe(0)
    expect(json?.summary.usedKeysChecked).toBe(0)
    expect(json?.summary.locale).toBe('de')
    expect(json?.limitation).toContain('line-based')
  })

  it('find_undefined_keys reports an undefined key and an uncertain dynamic usage', async () => {
    const dir = await makeProject()
    try {
      await mkdir(join(dir, 'components'), { recursive: true })
      await writeFile(join(dir, 'components/Page.vue'), [
        `{{ $t('actions.save') }}`,
        `{{ $t('missing.key') }}`,
        'const label = t(`dyn.${variant}`)',
      ].join('\n'))

      const { json } = await callTool('find_undefined_keys', { projectDir: dir })

      expect(json?.undefinedKeys).toEqual([
        expect.objectContaining({
          key: 'missing.key',
          searchedLayers: ['root'],
          usages: [{ file: join('components', 'Page.vue'), line: 2 }],
        }),
      ])
      expect(json?.uncertainKeys).toEqual([
        expect.objectContaining({
          key: '`dyn.${variant}`',
          usages: [{ file: join('components', 'Page.vue'), line: 3 }],
          reason: expect.stringContaining('dynamically built key'),
        }),
      ])
      expect(json?.summary.undefinedCount).toBe(1)
      expect(json?.summary.uncertainCount).toBe(1)
      expect(json?.summary.searchedLayersByApp).toEqual({ default: ['root'] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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

describe('provider mode via injected TranslateFn', () => {
  let providerProjectDir: string
  let providerClient: Client

  beforeAll(async () => {
    providerProjectDir = await makeProject()
    const { createServer } = await import('../src/server.js')
    providerClient = await connectClient(await createServer({ translateFn: fakeTranslateFn }))
  })

  afterAll(async () => {
    await providerClient.close()
    await rm(providerProjectDir, { recursive: true, force: true })
  })

  it('discover reports provider translation mode', async () => {
    const { json } = await callToolOn(providerClient, 'discover', { projectDir: providerProjectDir })

    expect(json?.translationMode).toBe('provider')
  })

  it('translate_missing translates through the backend and writes the target locale file', async () => {
    const { json } = await callToolOn(providerClient, 'translate_missing', {
      layer: 'root',
      projectDir: providerProjectDir,
    })

    expect(json?.summary.mode).toBe('provider')
    expect(json?.summary.totalTranslated).toBe(2)
    expect(json?.summary.totalFailed).toBe(0)
    expect(json?.fallbackContexts).toBeUndefined()
    expect(json?.results.en).toMatchObject({
      mode: 'provider',
      model: 'fake-model',
      failed: [],
      skipped: [],
    })

    const en = JSON.parse(
      await readFile(join(providerProjectDir, 'i18n', 'locales', 'en.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(en).toMatchObject({
      greeting: '[t] Hallo {name}',
      actions: { save: '[t] Speichern' },
    })
  })
})

describe('partial provider env config', () => {
  let partialProjectDir: string
  let partialClient: Client
  let stderrOutput: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeAll(async () => {
    partialProjectDir = await makeProject()

    // Provider named, but no model and no API key — must warn at startup and
    // serve agent mode.
    for (const name of ['I18N_PROVIDER', 'I18N_MODEL', 'OPENAI_API_KEY']) {
      savedEnv[name] = process.env[name]
    }
    process.env.I18N_PROVIDER = 'openai'
    delete process.env.I18N_MODEL
    delete process.env.OPENAI_API_KEY

    stderrOutput = ''
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk)
      return true
    })
    try {
      const { createServer } = await import('../src/server.js')
      partialClient = await connectClient(await createServer())
    } finally {
      stderrSpy.mockRestore()
    }
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await partialClient.close()
    await rm(partialProjectDir, { recursive: true, force: true })
  })

  it('logs a startup warning to stderr', () => {
    expect(stderrOutput).toContain('Partial provider config')
    expect(stderrOutput).toContain('agent mode')
  })

  it('discover reports agent mode', async () => {
    const { json } = await callToolOn(partialClient, 'discover', { projectDir: partialProjectDir })

    expect(json?.translationMode).toBe('agent')
  })

  it('translate_missing falls back to agent mode with fallback contexts', async () => {
    const { json } = await callToolOn(partialClient, 'translate_missing', {
      layer: 'root',
      projectDir: partialProjectDir,
    })

    expect(json?.summary.mode).toBe('agent')
    expect(json?.fallbackContexts?.en).toBeDefined()
  })
})

describe('dual-era serving through one factory', () => {
  // ttlMs/cacheScope are wire-level fields hidden from the public result
  // types but kept on the runtime objects — readable via this cast only.
  type CacheStamped = { ttlMs?: number, cacheScope?: string }

  let handler: McpHttpHandler
  let modernClient: Client

  const inProcessTransport = () =>
    new StreamableHTTPClientTransport(new URL('http://in-process.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    })

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    handler = createMcpHandler(() => createServer())
    modernClient = new Client(
      { name: 'modern-client', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    )
    await modernClient.connect(inProcessTransport())
  })

  afterAll(async () => {
    await modernClient.close()
    await handler.close()
  })

  it('negotiates the modern era via server/discover and serves tool calls', async () => {
    expect(modernClient.getProtocolEra()).toBe('modern')

    const { tools } = await modernClient.listTools()
    expect(tools.map(t => t.name)).toContain('discover')

    const { json } = await callToolOn(modernClient, 'discover', { projectDir })
    expect(json?.defaultLocale).toBe('de')
    expect(json?.translationMode).toBe('agent')
  })

  it('advertises server identity and capabilities on server/discover', () => {
    expect(modernClient.getServerVersion()).toMatchObject({ name: 'the-i18n-mcp' })

    const discover = modernClient.getDiscoverResult()
    expect(discover?.supportedVersions).toContain('2026-07-28')
    expect(discover?.capabilities?.tools).toBeDefined()
    expect(discover?.capabilities?.resources).toBeDefined()
    expect(discover?.capabilities?.prompts).toBeDefined()
  })

  it('stamps the configured cache hints on modern-era cacheable results', async () => {
    const discover = modernClient.getDiscoverResult() as CacheStamped | undefined
    expect(discover?.ttlMs).toBe(3_600_000)
    expect(discover?.cacheScope).toBe('private')

    const toolList = await modernClient.listTools() as CacheStamped
    expect(toolList.ttlMs).toBe(3_600_000)
    expect(toolList.cacheScope).toBe('private')

    // Resources deliberately have no configured hint: locale data must never
    // be cache-stale after a write tool ran. The SDK stamps ttlMs 0
    // (do-not-cache) on unconfigured cacheable results.
    const resourceRead = await modernClient.readResource({ uri: 'i18n:///root/de' }) as CacheStamped
    expect(resourceRead.ttlMs).toBe(0)
  })

  it('a resource read directly after a write returns the fresh content', async () => {
    await callToolOn(modernClient, 'write_translations', {
      layer: 'root',
      translations: { 'cache.probe': { de: 'frisch' } },
      projectDir,
    })

    const result = await modernClient.readResource({ uri: 'i18n:///root/de' })
    const content = result.contents[0] as { text: string }
    expect(JSON.parse(content.text)).toMatchObject({ cache: { probe: 'frisch' } })
  })

  it('serves a legacy-only client from the same entry point', async () => {
    const legacyClient = new Client({ name: 'legacy-client', version: '0.0.0' })
    await legacyClient.connect(inProcessTransport())
    try {
      expect(legacyClient.getProtocolEra()).toBe('legacy')

      const toolList = await legacyClient.listTools()
      expect(toolList.tools.map(t => t.name)).toContain('discover')
      expect((toolList as CacheStamped).ttlMs).toBeUndefined()

      const { json } = await callToolOn(legacyClient, 'discover', { projectDir })
      expect(json?.defaultLocale).toBe('de')
    } finally {
      await legacyClient.close()
    }
  })
})
