#!/usr/bin/env node
/**
 * Publish a package a second time under its scoped name.
 *
 * The kit is renaming to `@the-i18n-kit/*` (#315). During the window, both
 * names ship from one source at matching versions, so nobody has to choose
 * between an old package that stops moving and a new one they have not heard
 * of. One codebase, two names, no divergence.
 *
 * The tarball is assembled by hand rather than by `pnpm publish --filter`,
 * because renaming a workspace package breaks the filter that would select it.
 * Only the files the package already declares are copied, so the mirror cannot
 * ship more than the original.
 *
 * Usage: node scripts/mirror-package.mjs <packageDir> <scopedName>
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Names being mirrored, so an internal dependency points at its mirror too. */
export const MIRRORED = {
  'the-i18n-cli': '@the-i18n-kit/cli',
  'the-i18n-mcp': '@the-i18n-kit/mcp',
}

/**
 * The manifest the mirror publishes: renamed, with any dependency on a
 * mirrored sibling repointed at that sibling's mirror and pinned to the exact
 * version being published. A scoped package depending on an unscoped one would
 * leave the two halves of the rename tangled together forever.
 *
 * `workspace:` ranges are resolved here because npm cannot understand them —
 * pnpm normally does this during publish, and this path does not use it.
 */
export function mirrorManifest(manifest, scoped, versionOf) {
  const mirrored = { ...manifest, name: scoped }

  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = mirrored[field]
    if (!deps) continue

    const rewritten = {}
    for (const [dep, range] of Object.entries(deps)) {
      const target = MIRRORED[dep]
      if (target) {
        rewritten[target] = `^${versionOf(dep)}`
      }
      else {
        rewritten[dep] = range.startsWith('workspace:') ? `^${versionOf(dep)}` : range
      }
    }
    mirrored[field] = rewritten
  }

  return mirrored
}

function main(packageDir, scopedName) {
  const dir = resolve(packageDir)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))

  const versionOf = (dep) => {
    const candidates = ['cli', 'mcp', 'nuxt'].map(p => resolve('packages', p, 'package.json'))
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      const other = JSON.parse(readFileSync(candidate, 'utf-8'))
      if (other.name === dep) return other.version
    }
    throw new Error(`Cannot resolve the version of "${dep}" — it is not a package in this repo`)
  }

  const staging = mkdtempSync(join(tmpdir(), 'i18n-kit-mirror-'))

  for (const entry of manifest.files ?? []) {
    const from = join(dir, entry)
    if (existsSync(from)) cpSync(from, join(staging, entry), { recursive: true })
  }
  for (const entry of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
    const from = join(dir, entry)
    if (existsSync(from)) cpSync(from, join(staging, entry))
  }

  writeFileSync(
    join(staging, 'package.json'),
    `${JSON.stringify(mirrorManifest(manifest, scopedName, versionOf), null, 2)}\n`,
  )

  // MIRROR_DRY_RUN exists so the tarball can be inspected before a release
  // rather than after one. npm resolves and packs exactly as it would, and
  // stops short of uploading.
  const dryRun = process.env.MIRROR_DRY_RUN === '1'
  console.log(`Publishing ${scopedName}@${manifest.version} from ${dir}${dryRun ? ' (dry run)' : ''}`)
  execFileSync(
    'npm',
    ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])],
    { cwd: staging, stdio: 'inherit' },
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [packageDir, scopedName] = process.argv.slice(2)
  if (!packageDir || !scopedName) {
    console.error('Usage: node scripts/mirror-package.mjs <packageDir> <scopedName>')
    process.exit(1)
  }
  main(packageDir, scopedName)
}
