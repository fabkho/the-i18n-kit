/**
 * Directory helpers every framework shares: identifying a project directory,
 * and naming a layer after where it sits. Finding the apps in a project is a
 * framework's own business and lives with its adapter.
 */
import { realpathSync } from 'node:fs'
import { resolve, relative } from 'node:path'

export function canonicalPath(dir: string): string {
  try {
    return realpathSync(resolve(dir))
  }
  catch {
    return resolve(dir)
  }
}

/**
 * Derive a human-friendly layer name from its root directory.
 * Uses the discovery root as the reference point for naming.
 *
 * When `usedNames` is provided, disambiguates collisions by progressively
 * including parent path segments (e.g., `admin` → `apps/admin`).
 */
export function deriveLayerName(
  layerRootDir: string,
  discoveryRoot: string,
  usedNames?: Set<string>,
): string {
  const rel = relative(discoveryRoot, layerRootDir)
  if (rel === '' || rel === '.') {
    return 'root'
  }

  const posixRel = rel.replace(/\\/g, '/')

  if (!posixRel.startsWith('..')) {
    const segments = posixRel.split('/')
    let candidate = segments.pop() ?? posixRel

    if (usedNames) {
      for (let i = segments.length - 1; i >= 0; i--) {
        if (!usedNames.has(candidate)) break
        candidate = `${segments[i]}/${candidate}`
      }
    }

    return candidate
  }

  const parts = layerRootDir.replace(/\\/g, '/').split('/')
  let candidate = parts.pop() ?? layerRootDir

  if (usedNames) {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!usedNames.has(candidate)) break
      candidate = `${parts[i]}/${candidate}`
    }
  }

  return candidate
}
