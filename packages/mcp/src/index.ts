#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { toErrorMessage } from 'the-i18n-cli'
import { createServer } from './server.js'

try {
  const server = await createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
} catch (error) {
  process.stderr.write(`[the-i18n-mcp] Fatal error: ${toErrorMessage(error)}\n`)
  process.exit(1)
}
