#!/usr/bin/env node
// Install the stdout guard before anything else loads, so third-party logs
// (e.g. Nuxt modules during config detection) can never pollute the
// machine-readable output on stdout.
import { guardStdout } from './utils/stdout-guard.js'
guardStdout()
const { runCli } = await import('./cli.js')
await runCli()
