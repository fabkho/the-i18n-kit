import { sep } from 'node:path'

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
