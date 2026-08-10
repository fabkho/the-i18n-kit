import { createRequire } from 'node:module'
import { defineCommand, runCommand, runMain } from 'citty'
import { commands as allCommands } from './commands/index.js'
import { emitErrorResult } from './commands/_shared.js'

// Diagnostic commands kept out of the public CLI surface
const hiddenCommands = new Set(['detect', 'list-dirs', 'empty', 'scan'])
const commands = Object.fromEntries(
  Object.entries(allCommands).filter(([key]) => !hiddenCommands.has(key)),
)

const require = createRequire(import.meta.url)
const { version, description } = require('../package.json') as { version: string; description: string }

const main = defineCommand({
  meta: {
    name: 'the-i18n-cli',
    version,
    description,
  },
  subCommands: commands,
})

export async function runCli(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  // Let citty handle --help and --version natively (pretty-printed usage)
  if (rawArgs.includes('--help') || rawArgs.includes('-h')
    || rawArgs.includes('--version') || rawArgs.includes('-v')) {
    await runMain(main)
    return
  }

  // For normal execution, use runCommand so we control error output.
  // Command run() errors are handled inside createCommand; this catch only
  // sees pre-run failures (unknown command, argument parsing) — those must
  // also keep stdout parseable in JSON mode.
  try {
    await runCommand(main, { rawArgs })
  } catch (error: unknown) {
    emitErrorResult(error, { json: rawArgs.includes('--json') })
    process.exitCode = 1
  }
}
