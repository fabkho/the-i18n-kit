import { sep } from 'node:path'
import type { LocaleDir } from '../../config/types'
import { log } from '../../utils/logger'

export interface LayerRef {
  layer: string
  layerRootDir: string
}

export interface OwnershipResult {
  owner: string
  alias: string
}

function isAncestorOf(ancestorDir: string, childPath: string): boolean {
  const normalized = ancestorDir.endsWith(sep) ? ancestorDir : ancestorDir + sep
  return childPath.startsWith(normalized) || childPath === ancestorDir
}

function ancestorDepth(ancestorDir: string, childPath: string): number {
  if (!isAncestorOf(ancestorDir, childPath)) return -1
  return ancestorDir.split(sep).filter(Boolean).length
}

export function resolveLayerOwnership(
  existing: LayerRef,
  incoming: LayerRef,
  localeDirPath: string,
): OwnershipResult {
  const existingIsAncestor = isAncestorOf(existing.layerRootDir, localeDirPath)
  const incomingIsAncestor = isAncestorOf(incoming.layerRootDir, localeDirPath)

  if (existingIsAncestor && !incomingIsAncestor) {
    return { owner: existing.layer, alias: incoming.layer }
  }

  if (incomingIsAncestor && !existingIsAncestor) {
    return { owner: incoming.layer, alias: existing.layer }
  }

  if (existingIsAncestor && incomingIsAncestor) {
    const existingDepth = ancestorDepth(existing.layerRootDir, localeDirPath)
    const incomingDepth = ancestorDepth(incoming.layerRootDir, localeDirPath)
    if (incomingDepth > existingDepth) {
      return { owner: incoming.layer, alias: existing.layer }
    }
    return { owner: existing.layer, alias: incoming.layer }
  }

  return { owner: existing.layer, alias: incoming.layer }
}

/**
 * Claim a locale directory for a layer, deduplicating by real path.
 *
 * Mutates `dirs` and `claims`:
 * - First claim for `realPath`: the incoming dir is pushed and recorded as owner.
 * - Same path already claimed and the incoming layer wins ownership
 *   (see `resolveLayerOwnership`): the incoming dir replaces the previous
 *   owner in place, and the previous owner is re-pushed demoted to an alias.
 * - Same path already claimed and the existing layer keeps ownership: the
 *   incoming dir is pushed as an alias of the owner (unless it *is* the owner).
 * - If the recorded owner cannot be found as a non-alias entry (it was itself
 *   demoted to an alias by an earlier takeover on another path), the incoming
 *   dir is still pushed as an alias — a claim never silently drops a dir.
 */
export function claimLocaleDir(
  dirs: LocaleDir[],
  claims: Map<string, LayerRef>,
  incoming: LocaleDir,
  realPath: string,
): void {
  const existing = claims.get(realPath)

  if (!existing) {
    claims.set(realPath, { layer: incoming.layer, layerRootDir: incoming.layerRootDir })
    dirs.push({ ...incoming })
    return
  }

  const { owner, alias } = resolveLayerOwnership(
    { layer: existing.layer, layerRootDir: existing.layerRootDir },
    { layer: incoming.layer, layerRootDir: incoming.layerRootDir },
    realPath,
  )

  if (owner !== existing.layer) {
    const ownerIndex = dirs.findIndex(d => d.layer === existing.layer && !d.aliasOf)
    const previousOwner = ownerIndex !== -1 ? dirs[ownerIndex] : undefined
    if (previousOwner) {
      const promoted = { ...incoming }
      delete promoted.aliasOf
      dirs[ownerIndex] = promoted
      dirs.push({ ...previousOwner, aliasOf: owner })
      claims.set(realPath, { layer: incoming.layer, layerRootDir: incoming.layerRootDir })
      log.debug(`Layer '${alias}' is alias of '${owner}' (ancestor-based ownership, same path: ${incoming.path})`)
    }
    else {
      // Recorded owner is itself an alias — keep the incoming dir as an alias
      // instead of dropping it.
      dirs.push({ ...incoming, aliasOf: existing.layer })
      log.debug(`Layer '${incoming.layer}' is alias of '${existing.layer}' (owner already aliased, same path: ${incoming.path})`)
    }
  }
  else if (incoming.layer !== existing.layer) {
    dirs.push({ ...incoming, aliasOf: owner })
    log.debug(`Layer '${alias}' is alias of '${owner}' (same path: ${incoming.path})`)
  }
}
