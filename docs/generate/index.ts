/**
 * The filesystem shell around the reference builder: load the sources, build
 * the pages, write them out.
 *
 * Everything worth testing lives behind `buildReference`, which touches no
 * disk. This file is deliberately thin — if it grows logic, that logic belongs
 * in `reference/` instead.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReference } from './reference/build.js'
import { loadActionSource } from './sources/action.js'
import { loadCliSource } from './sources/cli.js'
import { loadMcpSource } from './sources/mcp.js'
import type { ReferenceOutput } from './reference/types.js'

const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url))

/**
 * Directories the builder owns outright, emptied before every run.
 *
 * Without this, a renamed or deleted command leaves its page behind and the
 * drift check passes on a reference that documents something that no longer
 * exists. Nothing hand-written may live under these paths.
 */
const OWNED_DIRS = ['9.reference']

async function main(): Promise<void> {
  // Loaded in parallel: the MCP listing spawns the built server and waits on a
  // protocol round trip, which is the slowest of the three by an order of
  // magnitude and has nothing to wait for from the others.
  const [cli, mcp, action] = await Promise.all([
    loadCliSource(),
    loadMcpSource(),
    loadActionSource(),
  ])
  const output = buildReference({ cli, mcp, action })

  for (const dir of OWNED_DIRS) {
    await rm(join(CONTENT_DIR, dir), { recursive: true, force: true })
  }
  await writeOutput(output)

  process.stdout.write(
    `Generated ${output.size} reference page(s) under ${relative(process.cwd(), CONTENT_DIR)}\n`,
  )
}

async function writeOutput(output: ReferenceOutput): Promise<void> {
  for (const [path, content] of output) {
    const target = join(CONTENT_DIR, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
  }
}

await main()
