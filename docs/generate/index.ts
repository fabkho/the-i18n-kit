/**
 * The filesystem shell around the reference builder: load the sources, build
 * the pages, write them out.
 *
 * Everything worth testing lives behind `buildReference`, which touches no
 * disk. This file is deliberately thin — if it grows logic, that logic belongs
 * in `reference/` instead.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReference } from './reference/build.js'
import { GENERATED_NOTICE } from './reference/markdown.js'
import { loadActionSource } from './sources/action.js'
import { loadCliSource } from './sources/cli.js'
import { loadConfigSource } from './sources/config.js'
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

async function main(): Promise<void> {
  // Loaded in parallel: the MCP listing spawns the built server and waits on a
  // protocol round trip, which is the slowest by an order of magnitude and has
  // nothing to wait for from the others.
  const [cli, mcp, action, config] = await Promise.all([
    loadCliSource(),
    loadMcpSource(),
    loadActionSource(),
    loadConfigSource(),
  ])
  const output = buildReference({ cli, mcp, action, config })

  await removeStaleGeneratedPages(output)
  await writeOutput(output)

  process.stdout.write(
    `Generated ${output.size} reference page(s) under ${relative(process.cwd(), CONTENT_DIR)}\n`,
  )
}

/**
 * Delete generated pages this run did not produce.
 *
 * Ownership is decided by the generated notice inside the file, never by which
 * directory it sits in. Two reasons it has to work that way:
 *
 * - The configuration reference sits among hand-written pages, because its
 *   route is part of the site's structure, so the directory around it cannot be
 *   wiped.
 * - A hand-written page inside a reference directory is legitimate — the
 *   programmatic API is one — and emptying that directory wholesale deleted it
 *   silently. The page vanished from the deploy while the readmes still linked
 *   to it.
 *
 * The notice also survives renaming a page, which a path list misses — leaving
 * a stale reference published under its old route.
 */
async function removeStaleGeneratedPages(output: ReferenceOutput): Promise<void> {
  const entries = await readdir(CONTENT_DIR, { recursive: true })
  const candidates = entries.filter(entry => entry.endsWith('.md') && !output.has(entry))

  for (const entry of candidates) {
    const path = join(CONTENT_DIR, entry)
    if (await isGenerated(path)) await rm(path)
  }
}

async function isGenerated(path: string): Promise<boolean> {
  return (await readFile(path, 'utf-8')).includes(GENERATED_NOTICE)
}

async function writeOutput(output: ReferenceOutput): Promise<void> {
  for (const [path, content] of output) {
    const target = join(CONTENT_DIR, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
  }
}

await main()
