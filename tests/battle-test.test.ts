import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { detectI18nConfig } from '../src/config/detector'
import { buildLayerScanPlan, findOrphanKeysForConfig } from '../src/scanner/code-scanner'
import { readLocaleData } from '../src/io/locale-data'
import { getPatternSet } from '../src/scanner/patterns'
import { describe, it, expect } from 'vitest'

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

const ANNY_UI = '/Users/fabiankirchhoff/code/anny/anny-ui'
const canRun = existsSync(ANNY_UI)

describe.skipIf(!canRun)('battle-test: anny-ui (Nuxt monorepo)', () => {
  let config: Awaited<ReturnType<typeof detectI18nConfig>>
  let orphanResult: Awaited<ReturnType<typeof findOrphanKeysForConfig>>

  it('detects config', async () => {
    config = await detectI18nConfig(ANNY_UI)
    console.log(`  Framework: ${config.framework}`)
    console.log(`  Locales: ${config.locales.length}`)
    console.log(`  Default locale: ${config.defaultLocale}`)
    console.log(`  Locale dirs: ${config.localeDirs.map(d => `${d.layer}${d.aliasOf ? ` (alias→${d.aliasOf})` : ''}`).join(', ')}`)
    console.log(`  Apps: ${config.apps.length}`)
    for (const app of config.apps) {
      console.log(`    📱 ${app.name} → layers: [${app.layers.join(', ')}]`)
    }
    expect(config.framework).toBe('nuxt')
    expect(config.apps.length).toBeGreaterThan(0)
  }, 60_000)

  it('scan plans include parent layer dirs', () => {
    for (const app of config.apps) {
      for (const layer of app.layers) {
        const plans = buildLayerScanPlan(layer, config.apps, undefined)
        console.log(`    Layer "${layer}" → scan ${plans.length} dir(s): [${plans.map(p => p.dir.replace(ANNY_UI, '.')).join(', ')}]`)
      }
    }
  })

  it('runs orphan detection', async () => {
    const keysByLayer = new Map<string, { keys: string[]; localeDir: { layer: string } }>()
    for (const dir of config.localeDirs) {
      if (dir.aliasOf) continue
      const refLocale = config.locales.find(l => l.code === config.defaultLocale) ?? config.locales[0]
      if (!refLocale) continue
      try {
        const data = await readLocaleData(config, dir.layer, refLocale)
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) continue
        const keys = flattenKeys(data as Record<string, unknown>)
        keysByLayer.set(dir.layer, { keys, localeDir: dir })
        console.log(`    📂 ${dir.layer}: ${keys.length} keys`)
      } catch (e) {
        console.log(`    ⚠️  Could not read ${dir.layer}: ${(e as Error).message}`)
      }
    }

    orphanResult = await findOrphanKeysForConfig({
      keysByLayer,
      apps: config.apps,
      resolveIgnorePatterns: (layerName) => config.projectConfig?.orphanScan?.[layerName]?.ignorePatterns,
      patterns: getPatternSet(config.localeFileFormat || 'json'),
    })

    console.log(`\n    Files scanned: ${orphanResult.totalFilesScanned}`)
    console.log(`    Dirs scanned: ${orphanResult.dirsScanned.map(d => d.replace(ANNY_UI, '.')).join(', ')}`)
    console.log(`    Total orphans: ${orphanResult.orphanCount}`)
    console.log(`    Dynamic matched: ${orphanResult.dynamicMatchedCount}`)
    console.log(`    Ignored: ${orphanResult.ignoredCount}`)

    for (const [layer, orphans] of Object.entries(orphanResult.orphansByLayer)) {
      console.log(`\n    Layer "${layer}": ${orphans.length} orphans`)
      for (const key of orphans.slice(0, 20)) {
        console.log(`      🔑 ${key}`)
      }
      if (orphans.length > 20) console.log(`      ... and ${orphans.length - 20} more`)
    }

    expect(orphanResult).toBeDefined()
    expect(orphanResult.totalFilesScanned).toBeGreaterThan(0)
  }, 120_000)

  it('outputs all orphan keys for spot-checking', () => {
    for (const [layer, orphans] of Object.entries(orphanResult.orphansByLayer)) {
      console.log(`\n=== ${layer} (${orphans.length}) ===`)
      for (const key of orphans) {
        console.log(key)
      }
    }
  })
})
