/**
 * Report-file plumbing: path validation and resolution for tools that
 * support writing their output to a JSON report file.
 */

import { resolve, relative } from 'node:path'

import type { I18nConfig } from '../config/types.js'
import { ToolError } from '../utils/errors.js'

const DEFAULT_REPORT_DIR = '.i18n-reports'

export function validateReportPath(baseDir: string, absPath: string): void {
  const normalizedBase = resolve(baseDir)
  const normalizedPath = resolve(absPath)
  const rel = relative(normalizedBase, normalizedPath)
  if (rel.startsWith('..') || rel === '') {
    throw new ToolError(
      `Report path "${absPath}" resolves outside the project directory. Path must stay within "${normalizedBase}".`,
      'INVALID_REPORT_PATH',
    )
  }
}

export function resolveReportFilePath(
  config: I18nConfig,
  dir: string,
  toolName: string,
): string | undefined {
  const reportOutput = config.projectConfig?.reportOutput
  if (!reportOutput) return undefined
  const relDir = reportOutput === true ? DEFAULT_REPORT_DIR : reportOutput
  const absPath = resolve(dir, relDir, `${toolName}.json`)
  validateReportPath(dir, absPath)
  return absPath
}
