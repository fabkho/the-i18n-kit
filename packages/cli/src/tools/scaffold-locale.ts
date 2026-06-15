import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { I18nConfig, LocaleDefinition } from '../config/types'
import { readLocaleData, resolveLocaleEntries } from '../io/locale-data'
import { readLocale, writeLocale } from '../io/locale-io'
import { getLeafKeys } from '../io/key-operations'
import { ToolError } from '../utils/errors'

export interface ScaffoldLocaleOptions {
  locales?: string[]
  layer?: string
  dryRun?: boolean
}

export interface ScaffoldedFile {
  locale: string
  layer: string
  file: string
  keys: number
  namespace?: string
}

export interface ScaffoldLocaleResult {
  created: ScaffoldedFile[]
  skipped: ScaffoldedFile[]
}

export function buildEmptyStructure(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      result[key] = ''
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = buildEmptyStructure(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

export async function scaffoldLocale(
  config: I18nConfig,
  options: ScaffoldLocaleOptions = {},
): Promise<ScaffoldLocaleResult> {
  const { locales: localeCodes, layer: layerFilter, dryRun } = options

  const layers = layerFilter
    ? config.localeDirs.filter(d => d.layer === layerFilter)
    : config.localeDirs.filter(d => !d.aliasOf)

  if (layerFilter && layers.length === 0) {
    throw new ToolError(
      `Layer not found: "${layerFilter}". Available: ${config.localeDirs.map(d => d.layer).join(', ')}`,
      'LAYER_NOT_FOUND',
    )
  }

  if (layerFilter && layers[0]?.aliasOf) {
    throw new ToolError(
      `Layer "${layerFilter}" is an alias of "${layers[0].aliasOf}". Use the target layer instead.`,
      'LAYER_IS_ALIAS',
    )
  }

  const refLocale = config.locales.find(l => l.code === config.defaultLocale)
  if (!refLocale) {
    throw new ToolError(
      `Default locale "${config.defaultLocale}" not found in config`,
      'LOCALE_NOT_FOUND',
    )
  }

  const targetLocales = localeCodes
    ? localeCodes.map((code) => {
        const loc = config.locales.find(l => l.code === code)
        if (!loc) {
          throw new ToolError(
            `Locale "${code}" not found in config. Available: ${config.locales.map(l => l.code).join(', ')}`,
            'LOCALE_NOT_FOUND',
          )
        }
        return loc
      })
    : findNewLocales(config, layers)

  const created: ScaffoldedFile[] = []
  const skipped: ScaffoldedFile[] = []

  for (const dir of layers) {
    if (config.localeFileFormat === 'php-array') {
      await scaffoldPhpLayer(config, dir, refLocale, targetLocales, dryRun, created, skipped)
    } else {
      await scaffoldJsonLayer(config, dir, refLocale, targetLocales, dryRun, created, skipped)
    }
  }

  return { created, skipped }
}

async function scaffoldJsonLayer(
  config: I18nConfig,
  dir: I18nConfig['localeDirs'][0],
  refLocale: LocaleDefinition,
  targets: LocaleDefinition[],
  dryRun: boolean | undefined,
  created: ScaffoldedFile[],
  skipped: ScaffoldedFile[],
): Promise<void> {
  const refData = await readLocaleData(config, dir.layer, refLocale)
  if (Object.keys(refData).length === 0) {
    throw new ToolError(
      `Reference locale "${refLocale.code}" has no data in layer "${dir.layer}". Cannot scaffold without reference keys.`,
      'NO_REFERENCE_DATA',
    )
  }

  const emptyData = buildEmptyStructure(refData)
  const keyCount = getLeafKeys(refData).length

  for (const target of targets) {
    const entries = await resolveLocaleEntries(config, dir.layer, target)
    const targetPath = entries.length > 0 ? entries[0].path : join(dir.path, target.file ?? `${target.code}.json`)

    if (existsSync(targetPath)) {
      skipped.push({ locale: target.code, layer: dir.layer, file: targetPath, keys: keyCount })
      continue
    }

    if (!dryRun) {
      await writeLocale(targetPath, emptyData)
    }
    created.push({ locale: target.code, layer: dir.layer, file: targetPath, keys: keyCount })
  }
}

async function scaffoldPhpLayer(
  config: I18nConfig,
  dir: I18nConfig['localeDirs'][0],
  refLocale: LocaleDefinition,
  targets: LocaleDefinition[],
  dryRun: boolean | undefined,
  created: ScaffoldedFile[],
  skipped: ScaffoldedFile[],
): Promise<void> {
  const refEntries = await resolveLocaleEntries(config, dir.layer, refLocale)
  if (refEntries.length === 0) {
    throw new ToolError(
      `Reference locale "${refLocale.code}" has no PHP files in layer "${dir.layer}". Cannot scaffold without reference keys.`,
      'NO_REFERENCE_DATA',
    )
  }

  for (const target of targets) {
    const targetDir = join(dir.path, target.code)
    const dirExists = existsSync(targetDir)

    for (const refEntry of refEntries) {
      const fileName = basename(refEntry.path)
      const namespace = fileName.replace(/\.php$/, '')
      const targetPath = join(targetDir, fileName)

      if (dirExists && existsSync(targetPath)) {
        const refData = await readLocale(refEntry.path)
        const keyCount = getLeafKeys(refData).length
        skipped.push({ locale: target.code, layer: dir.layer, file: targetPath, keys: keyCount, namespace })
        continue
      }

      const refData = await readLocale(refEntry.path)
      const emptyData = buildEmptyStructure(refData)
      const keyCount = getLeafKeys(refData).length

      if (!dryRun) {
        await writeLocale(targetPath, emptyData)
      }
      created.push({ locale: target.code, layer: dir.layer, file: targetPath, keys: keyCount, namespace })
    }
  }
}

function findNewLocales(config: I18nConfig, layers: I18nConfig['localeDirs']): LocaleDefinition[] {
  if (config.localeFileFormat === 'php-array') {
    return config.locales.filter((locale) => {
      return layers.some((dir) => {
        return !existsSync(join(dir.path, locale.code))
      })
    })
  }

  return config.locales.filter((locale) => {
    return layers.some((dir) => {
      const filePath = join(dir.path, locale.file ?? `${locale.code}.json`)
      return !existsSync(filePath)
    })
  })
}
