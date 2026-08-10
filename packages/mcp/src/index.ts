#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { toErrorMessage } from 'the-i18n-cli'
import { createServer } from './server.js'

// serveStdio owns the era decision: the opening exchange pins the connection
// to 2026-07-28 (server/discover) or the legacy era (initialize) — one factory
// instance serves whichever era the host speaks. stderr is the only log
// channel; stdout belongs to the JSON-RPC wire.
try {
  serveStdio(() => createServer(), {
    onerror: (error) => {
      process.stderr.write(`[the-i18n-mcp] ${toErrorMessage(error)}\n`)
    },
  })
} catch (error) {
  process.stderr.write(`[the-i18n-mcp] Fatal error: ${toErrorMessage(error)}\n`)
  process.exit(1)
}
