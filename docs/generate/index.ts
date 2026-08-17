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
import { loadCliSource } from './sources/cli.js'
import { loadConfigSource } from './sources/config.js'
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
  const [cli, config] = await Promise.all([loadCliSource(), loadConfigSource()])
  const output = buildReference({ cli, config })

  for (const dir of OWNED_DIRS) {
    await rm(join(CONTENT_DIR, dir), { recursive: true, force: true })
  }
  await removeStaleGeneratedPages(output)
  await writeOutput(output)

  process.stdout.write(
    `Generated ${output.size} reference page(s) under ${relative(process.cwd(), CONTENT_DIR)}\n`,
  )
}

/**
 * Delete generated pages this run did not produce.
 *
 * The reference directories above are owned outright and emptied wholesale. The
 * configuration reference is not in one: it sits among hand-written pages
 * because its route is part of the site's structure, so the directory around it
 * cannot be wiped. Ownership is decided by the generated notice inside the file
 * instead, which also survives renaming the page — the case a path list misses,
 * leaving a stale reference published under its old route.
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
