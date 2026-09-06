/**
 * Consumer-graph inference from the package manager workspace.
 *
 * Everything the kit does across layers — app-scoped orphan evidence,
 * misplaced usages, unconsumed layers — runs on `config.apps`: which app can
 * render which layer's keys. Only the Nuxt adapter can answer that from
 * framework knowledge, because a Nuxt `extends` chain *is* a consumer graph.
 * For every other stack the same answer is already written down in the
 * workspace: a package that contains a locale dir owns that layer, and a
 * `package.json` dependency edge from one such package to another is a
 * consumption edge.
 *
 * ## What counts as an app
 *
 * An app is a layer-owning workspace package that no *other* layer-owning
 * package depends on, directly or transitively — the roots of the
 * layer-owning subgraph. A package something else depends on (a UI kit, a
 * shared locale package) is not an app of its own: its keys are rendered by
 * its dependents, and calling it an app would tell the orphan scan that its
 * own directory is a place where its keys may legitimately be used, which is
 * evidence the scan must never invent. When every layer-owning package is
 * depended on by another one — a dependency cycle, which package managers
 * permit — there is no root to pick, and then every layer-owning package
 * becomes an app: a graph wider than the truth, never narrower, and narrower
 * is the direction that deletes keys. Each app consumes its own layers plus
 * the layers of its transitive dependencies. Layers that lie outside every
 * workspace package are attached to every app, so an unclaimed locale dir
 * keeps behaving exactly as it does without inference.
 *
 * Inference is refused (`null`) when the project is not a workspace, when no
 * package owns a layer, or when fewer than two apps come out of it — the
 * single-app fallback the adapters build is already correct for those, and
 * replacing it would change names for no gain.
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import type { AppInfo, LocaleDir } from './types.js'
import { log } from '../utils/logger.js'

/** A package in the workspace, with its edges to other workspace packages. */
export interface WorkspacePackage {
  /** Absolute path to the directory holding the package.json. */
  dir: string
  /** `name` from the manifest, or the directory name when it declares none. */
  name: string
  /** Names of other workspace packages this one depends on (direct edges). */
  deps: string[]
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

/**
 * Derive the consumer graph for `layers` from the workspace `projectDir` is
 * the root of. Returns null when the workspace cannot answer the question —
 * see the module header for which cases those are and why.
 */
export async function inferWorkspaceApps(
  projectDir: string,
  layers: LocaleDir[],
): Promise<AppInfo[] | null> {
  const workspace = await readWorkspacePatterns(projectDir)
  if (!workspace) return null

  const packages = await readWorkspacePackages(projectDir, workspace.patterns)
  if (packages.length === 0) return null

  log.debug(
    `Workspace consumer graph: ${packages.length} package(s) from ${workspace.source} `
    + `(${workspace.patterns.join(', ')})`,
  )

  return buildWorkspaceApps(packages, layers)
}

/**
 * The inference itself, over already-read workspace packages: ownership by
 * directory containment, consumption by dependency edges.
 */
export function buildWorkspaceApps(
  packages: WorkspacePackage[],
  layers: LocaleDir[],
): AppInfo[] | null {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))

  // Alias entries are skipped: their locale dir belongs to the layer they
  // point at, so owning them by path would credit the wrong package.
  const canonical = layers.filter(layer => !layer.aliasOf)

  const ownedBy = new Map<string, string[]>()
  const unowned: string[] = []
  for (const layer of canonical) {
    const owner = ownerOfDir(packages, layer.path)
    if (!owner) {
      unowned.push(layer.layer)
      continue
    }
    const owned = ownedBy.get(owner.name) ?? []
    owned.push(layer.layer)
    ownedBy.set(owner.name, owned)
  }

  if (ownedBy.size === 0) return null

  const closure = transitiveClosure(byName)

  const depended = new Set<string>()
  for (const name of ownedBy.keys()) {
    for (const dep of closure.get(name) ?? []) {
      if (dep !== name && ownedBy.has(dep)) depended.add(dep)
    }
  }

  const roots = [...ownedBy.keys()].filter(name => !depended.has(name))
  const appNames = (roots.length > 0 ? roots : [...ownedBy.keys()]).sort()
  if (appNames.length < 2) return null

  return appNames.map((name) => {
    const consumed = new Set(ownedBy.get(name) ?? [])
    for (const dep of closure.get(name) ?? []) {
      for (const layer of ownedBy.get(dep) ?? []) consumed.add(layer)
    }
    for (const layer of unowned) consumed.add(layer)

    return {
      name,
      rootDir: byName.get(name)!.dir,
      // Reported in the config's own layer order, so two runs agree.
      layers: canonical.filter(layer => consumed.has(layer.layer)).map(layer => layer.layer),
      source: 'workspace' as const,
    }
  })
}

// ─── Workspace discovery ────────────────────────────────────────

/**
 * The package globs of the workspace rooted at `projectDir`, from whichever
 * package manager declares one. Only `projectDir` itself is inspected: a
 * project detected from inside one workspace package is that package's
 * project, and reading the enclosing workspace would widen the graph past
 * what the caller asked about.
 */
async function readWorkspacePatterns(
  projectDir: string,
): Promise<{ patterns: string[]; source: string } | null> {
  for (const file of ['pnpm-workspace.yaml', 'pnpm-workspace.yml']) {
    const raw = await readFileOrNull(join(projectDir, file))
    if (raw === null) continue
    const patterns = parsePnpmWorkspacePackages(raw)
    if (patterns.length > 0) return { patterns, source: file }
  }

  const manifest = await readJsonOrNull(join(projectDir, 'package.json'))
  const patterns = manifest ? workspacesField(manifest) : []
  return patterns.length > 0 ? { patterns, source: 'package.json' } : null
}

/**
 * The `packages:` sequence of a `pnpm-workspace.yaml`, in block or flow form.
 *
 * A hand-rolled reader rather than a YAML parser: the file's other keys are
 * none of our business, one list of strings is the whole contract, and a
 * parser dependency for it would ship in every install.
 */
export function parsePnpmWorkspacePackages(yamlText: string): string[] {
  const patterns: string[] = []
  let inBlock = false

  for (const line of yamlText.split(/\r?\n/)) {
    if (!inBlock) {
      const header = /^packages:\s*(.*)$/.exec(line)
      if (!header) continue
      const inline = header[1]!.trim()
      if (inline.startsWith('[')) {
        const end = inline.lastIndexOf(']')
        return inline.slice(1, end === -1 ? inline.length : end)
          .split(',')
          .map(item => unquote(item.trim()))
          .filter(item => item.length > 0)
      }
      inBlock = true
      continue
    }

    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const item = /^-\s*(.+)$/.exec(trimmed)
    // Anything that is not a sequence entry ends the block — the next key.
    if (!item) break
    const value = unquote(item[1]!.trim())
    if (value.length > 0) patterns.push(value)
  }

  return patterns
}

/** The npm/yarn `workspaces` field, in both of its accepted spellings. */
function workspacesField(manifest: Record<string, unknown>): string[] {
  const field = manifest.workspaces
  if (Array.isArray(field)) return field.filter((p): p is string => typeof p === 'string')
  if (field && typeof field === 'object') {
    const nested = (field as { packages?: unknown }).packages
    if (Array.isArray(nested)) return nested.filter((p): p is string => typeof p === 'string')
  }
  return []
}

/** Expand the workspace globs to the packages they name. */
async function readWorkspacePackages(
  projectDir: string,
  patterns: string[],
): Promise<WorkspacePackage[]> {
  const include = patterns.filter(p => !p.startsWith('!'))
  const exclude = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1))
  if (include.length === 0) return []

  let manifests: string[]
  try {
    manifests = await glob(include.map(toManifestPattern), {
      cwd: projectDir,
      absolute: true,
      // Installed copies of a workspace package are not the package.
      ignore: ['**/node_modules/**', ...exclude.map(toManifestPattern)],
    })
  }
  catch (error) {
    log.debug(`Workspace consumer graph: glob failed (${String(error)})`)
    return []
  }

  const packages: WorkspacePackage[] = []
  for (const manifest of manifests) {
    const pkg = await readJsonOrNull(manifest)
    if (!pkg) continue
    const dir = dirname(resolve(manifest))
    const declared = typeof pkg.name === 'string' ? pkg.name.trim() : ''
    packages.push({
      dir,
      name: declared.length > 0 ? declared : basename(dir),
      deps: dependencyNames(pkg),
    })
  }

  // Edges to packages outside the workspace say nothing about layers.
  const names = new Set(packages.map(pkg => pkg.name))
  return packages.map(pkg => ({
    ...pkg,
    deps: pkg.deps.filter(dep => dep !== pkg.name && names.has(dep)),
  }))
}

/**
 * A workspace glob names directories; matching their manifests instead keeps
 * directories that are not packages (a `packages/*` that also holds docs) out
 * of the graph.
 */
function toManifestPattern(pattern: string): string {
  const trimmed = pattern.replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '.') return 'package.json'
  return `${trimmed}/package.json`
}

/**
 * Dependency names across every field that can carry a workspace edge. The
 * version range is irrelevant — `workspace:*`, a published range, or a file
 * link all mean the same thing once the name matches a workspace package.
 */
function dependencyNames(manifest: Record<string, unknown>): string[] {
  const names: string[] = []
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field]
    if (deps && typeof deps === 'object') names.push(...Object.keys(deps))
  }
  return names
}

// ─── Graph helpers ──────────────────────────────────────────────

/** The innermost workspace package containing `dir`, if any. */
function ownerOfDir(packages: WorkspacePackage[], dir: string): WorkspacePackage | undefined {
  let best: WorkspacePackage | undefined
  for (const pkg of packages) {
    if (!isWithin(dir, pkg.dir)) continue
    if (!best || pkg.dir.length > best.dir.length) best = pkg
  }
  return best
}

/** True when `child` equals `parent` or lies inside it. */
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Package name → every workspace package reachable from it. Cycle-safe. */
function transitiveClosure(byName: Map<string, WorkspacePackage>): Map<string, Set<string>> {
  const closure = new Map<string, Set<string>>()

  for (const [name, pkg] of byName) {
    const reachable = new Set<string>()
    const stack = [...pkg.deps]
    while (stack.length > 0) {
      const next = stack.pop()!
      if (reachable.has(next)) continue
      const dep = byName.get(next)
      if (!dep) continue
      reachable.add(next)
      stack.push(...dep.deps)
    }
    closure.set(name, reachable)
  }

  return closure
}

// ─── File reading ───────────────────────────────────────────────

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  }
  catch {
    return null
  }
}

async function readJsonOrNull(path: string): Promise<Record<string, unknown> | null> {
  const raw = await readFileOrNull(path)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  }
  catch {
    log.debug(`Workspace consumer graph: ignoring unparseable ${path}`)
    return null
  }
}

/** Strip YAML quoting and any trailing comment from a sequence entry. */
function unquote(value: string): string {
  const quoted = /^(['"])(.*?)\1/.exec(value)
  if (quoted) return quoted[2]!
  const hash = value.indexOf(' #')
  return (hash === -1 ? value : value.slice(0, hash)).trim()
}
