import { createRequire } from 'node:module'
import { defineCommand, runCommand, runMain } from 'citty'
import { consola } from 'consola'
import { commands as allCommands } from './commands/index.js'

// Hidden diagnostic commands: detect, list-dirs, empty, scan
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

  // For normal execution, use runCommand so we control error output
  try {
    await runCommand(main, { rawArgs })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    consola.error(message)
    if (rawArgs.includes('--debug') && error instanceof Error && error.stack) {
      consola.error(error.stack)
    }
    process.exitCode = 1
  }
}
