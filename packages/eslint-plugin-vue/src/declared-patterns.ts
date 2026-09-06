import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createJiti } from 'jiti'

/**
 * The key patterns a project's kit config declares: `declaredNamespaces`
 * entries — namespaces whose keys exist by contract rather than by a call
 * site — plus the per-layer orphan-scan ignore patterns, which protect keys
 * the same way. Loaded with jiti so the TS config needs no build, cached by
 * path + mtime so the editor sees a just-added declaration.
 */

const CONFIG_NAMES = ['i18n-kit.config.ts', 'i18n-kit.config.mjs', 'i18n-kit.config.js']

const cache = new Map<string, { mtime: number, patterns: Set<string> }>()

export function findKitConfig(fromFile: string): string | undefined {
  let dir = dirname(fromFile)
  for (let i = 0; i < 30; i++) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

export function declaredPatterns(configPath: string): Set<string> {
  const mtime = statSync(configPath).mtimeMs
  const cached = cache.get(configPath)
  if (cached && cached.mtime === mtime) return cached.patterns

  const patterns = new Set<string>()
  try {
    const load = createJiti(configPath)
    const mod = load(configPath) as { default?: KitConfigShape } | KitConfigShape
    const config = ('default' in mod ? mod.default : mod) as KitConfigShape | undefined
    for (const declaration of config?.declaredNamespaces ?? []) {
      if (declaration?.pattern) patterns.add(declaration.pattern)
    }
    for (const layer of Object.values(config?.orphanScan ?? {})) {
      for (const pattern of layer?.ignorePatterns ?? []) patterns.add(pattern)
    }
  } catch {
    // An unreadable config declares nothing; the rule's message says how to
    // declare, which is the right nudge either way.
  }
  cache.set(configPath, { mtime, patterns })
  return patterns
}

interface KitConfigShape {
  declaredNamespaces?: Array<{ pattern?: string; reason?: string } | undefined>
  orphanScan?: Record<string, { ignorePatterns?: string[] } | undefined>
}

export function resetDeclaredPatternsCacheForTests(): void {
  cache.clear()
}
