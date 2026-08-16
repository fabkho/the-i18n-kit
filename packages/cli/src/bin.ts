#!/usr/bin/env node
// Install the stdout guard before anything else loads, so third-party logs
// (e.g. Nuxt modules during config detection) can never pollute the
// machine-readable output on stdout. Help/version invocations skip the guard:
// they never load third-party code and their output belongs on stdout
// (mirrors the flag check in cli.ts, which cannot be imported before the
// guard decision).
import { guardStdout } from './utils/stdout-guard.js'

const args = process.argv.slice(2)
const isHelpOrVersion = args.includes('--help') || args.includes('-h')
  || args.includes('--version') || args.includes('-v')
if (!isHelpOrVersion) {
  guardStdout()
}
// Renamed packages announce themselves once per invocation, on stderr so the
// JSON on stdout is untouched. The package reads its own name, so this is
// silent when running as @the-i18n-kit/cli (#315).
const { renameNotice } = await import('./utils/rename-notice.js')
const { createRequire } = await import('node:module')
const { name } = createRequire(import.meta.url)('../package.json') as { name: string }
const notice = renameNotice(name)
if (notice) process.stderr.write(`[the-i18n-cli] ${notice}\n`)

const { runCli } = await import('./cli.js')
await runCli()
