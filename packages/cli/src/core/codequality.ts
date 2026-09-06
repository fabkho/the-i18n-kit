/**
 * GitLab Code Quality (CodeClimate) mapping — pure result-shape → issue-array
 * transforms, no I/O.
 *
 * Format contract (https://docs.gitlab.com/ci/testing/code_quality/):
 * every issue needs description, check_name, fingerprint, severity, and
 * location.path + location.lines.begin, where path is project-root-relative
 * (no leading `./`) and lines.begin is an integer ≥ 1.
 *
 * Fingerprints deliberately exclude line numbers so unrelated edits that
 * shift a usage do not churn findings as new/resolved in the MR widget.
 */

import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'

import type { I18nConfig, LocaleDefinition } from '../config/types.js'

import type { UndefinedKeyFinding } from './ops-check.js'
import { resolveReferenceLocale } from './shared.js'

export interface CodeQualityIssue {
  description: string
  check_name: string
  fingerprint: string
  severity: 'info' | 'minor' | 'major' | 'critical' | 'blocker'
  location: {
    path: string
    lines: { begin: number }
  }
}

const UNDEFINED_KEY_CHECK = 'i18n.undefined-key'
const ORPHAN_KEY_CHECK = 'i18n.orphan-key'

/** NUL-joined so no part can bleed into its neighbor (keys/paths never contain NUL). */
function fingerprintOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

/** Normalize to the report's path shape: forward slashes, no leading `./`. */
function toReportPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.startsWith('./') ? normalized.slice(2) : normalized
}

/** GitLab rejects non-positive or fractional line numbers. */
function toLineBegin(line: number): number {
  return Math.max(1, Math.trunc(line))
}

/**
 * `check` findings → one issue per usage location. Uncertain findings are
 * not mapped: the widget has no "maybe" state, and a hard-looking finding
 * for an unverifiable key would train consumers to ignore the report.
 */
export function undefinedKeysToCodeQuality(undefinedKeys: UndefinedKeyFinding[]): CodeQualityIssue[] {
  const issues: CodeQualityIssue[] = []
  for (const finding of undefinedKeys) {
    for (const usage of finding.usages) {
      const path = toReportPath(usage.file)
      issues.push({
        description: `i18n key "${finding.key}" is referenced here but defined in no locale file of the consuming app's layers — it renders as the raw key at runtime.`,
        check_name: UNDEFINED_KEY_CHECK,
        fingerprint: fingerprintOf(UNDEFINED_KEY_CHECK, finding.key, path),
        severity: 'major',
        location: { path, lines: { begin: toLineBegin(usage.line) } },
      })
    }
  }
  return issues
}

/**
 * Orphan findings → one issue per key, anchored at the layer's
 * reference-locale file (line 1): orphans live in locale files, not code.
 * The fingerprint is anchor-independent (layer + key), so locale-file
 * renames or layout changes do not churn findings. Uncertain,
 * dynamic-matched, and misplaced keys are not part of `orphansByLayer`
 * and therefore never mapped.
 */
export function orphanKeysToCodeQuality(
  orphansByLayer: Record<string, string[]>,
  anchorFileByLayer: Record<string, string>,
): CodeQualityIssue[] {
  const issues: CodeQualityIssue[] = []
  for (const [layer, keys] of Object.entries(orphansByLayer)) {
    // A missing anchor (layer absent from config) degrades to the layer name
    // as path — the fingerprint is path-independent, so findings stay stable.
    const path = toReportPath(anchorFileByLayer[layer] ?? layer)
    for (const key of keys) {
      issues.push({
        description: `Orphan i18n key "${key}" in layer "${layer}" has no source-code reference — it may be consumed dynamically; verify before deleting.`,
        check_name: ORPHAN_KEY_CHECK,
        fingerprint: fingerprintOf(ORPHAN_KEY_CHECK, layer, key),
        severity: 'minor',
        location: { path, lines: { begin: 1 } },
      })
    }
  }
  return issues
}

/**
 * The orphan findings of a result — whatever the run was asked to do with
 * them — mapped and anchored in one call.
 *
 * Takes the result rather than the scan internals, which is what lets the
 * mapping run where the result is handed over instead of inside the operation.
 * A removal run reports what it deleted; either way the keys are the same set
 * the scan found, and nothing else in the result is a finding.
 */
export function orphanResultToCodeQuality(
  result: { orphanKeys?: Record<string, string[]>; removed?: Record<string, string[]> },
  ctx: { config: I18nConfig; projectDir: string; locale?: string },
): CodeQualityIssue[] {
  const orphansByLayer = result.orphanKeys ?? result.removed ?? {}
  const { localeDef } = resolveReferenceLocale(ctx.config, ctx.locale)
  return orphanKeysToCodeQuality(
    orphansByLayer,
    referenceLocaleAnchorPaths(ctx.config, Object.keys(orphansByLayer), localeDef, ctx.projectDir),
  )
}

/**
 * Project-root-relative reference-locale file path per layer, the anchor for
 * orphan issues. Aliases resolve to their target layer's directory. Flat
 * layouts anchor at the locale file; namespaced layouts (per-locale
 * directories) have no single file and anchor at the locale's directory.
 */
export function referenceLocaleAnchorPaths(
  config: I18nConfig,
  layers: string[],
  locale: LocaleDefinition,
  projectDir: string,
): Record<string, string> {
  const anchors: Record<string, string> = {}
  for (const layer of layers) {
    const localeDir = config.localeDirs.find(d => d.layer === layer)
    const resolved = localeDir?.aliasOf
      ? config.localeDirs.find(d => d.layer === localeDir.aliasOf) ?? localeDir
      : localeDir
    if (!resolved) continue
    const absPath = locale.file
      ? join(resolved.path, locale.file)
      : join(resolved.path, locale.code)
    anchors[layer] = toReportPath(relative(projectDir, absPath))
  }
  return anchors
}
