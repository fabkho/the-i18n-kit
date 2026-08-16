import { afterAll, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'

/**
 * A throwaway project directory per test, plus a `write` for putting config
 * files in it.
 *
 * One directory *per test*, not per file: Node caches an ES module by URL for
 * the life of the process, so two tests writing different configs to the same
 * path would both see whichever ran first. Which is also the reason the
 * production code remembers what it read — see `readVueI18nLocaleDirs`.
 */
export function tmpProject(name: string) {
  const root = resolve(import.meta.dirname, `../../.tmp-${name}`)
  let dir = root
  let n = 0

  beforeEach(() => {
    dir = resolve(root, `case-${n++}`)
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  return {
    /** The current test's directory. */
    get dir() {
      return dir
    },
    /** The shared root, for tests that need a second project of their own. */
    root,
    /** Write a file, creating any directories along the way. */
    async write(relativePath: string, contents: string, into = dir) {
      const path = resolve(into, relativePath)
      await mkdir(resolve(path, '..'), { recursive: true })
      await writeFile(path, contents, 'utf-8')
      return path
    },
    /** Create the directory without putting anything in it. */
    async empty() {
      await mkdir(dir, { recursive: true })
      return dir
    },
  }
}
