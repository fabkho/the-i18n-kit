import type { LocaleFileFormat } from '../adapters/types'

/**
 * A single locale definition as detected from the framework config.
 */
export interface LocaleDefinition {
  /** Locale code used in URLs and as identifier (e.g., 'de', 'en', 'en-us') */
  code: string
  /** BCP-47 language tag (e.g., 'de-DE', 'en-GB') */
  language: string
  /** Locale filename (e.g., 'de-DE.json'). Optional for directory-per-locale layouts (Laravel). */
  file?: string
  /** Human-readable name (e.g., 'Deutsch') */
  name?: string
}

/**
 * A locale directory discovered from a Nuxt layer.
 */
export interface LocaleDir {
  /** Absolute path to the locale directory */
  path: string
  /** Layer name (e.g., 'root', 'app-admin', 'app-shop') */
  layer: string
  /** Absolute path to the layer's root directory */
  layerRootDir: string
  /** If this dir is a symlink/alias to another layer's dir (e.g., app-outlook -> app-shop) */
  aliasOf?: string
}

export interface AppInfo {
  /** App name (e.g., 'app-admin', 'root') */
  name: string
  /** Absolute path to the app's root directory */
  rootDir: string
  /** Layer names this app consumes (from _layers) */
  layers: string[]
}

/**
 * Project-specific configuration from `.i18n-mcp.json`.
 * All fields are optional — the server passes them to the agent as-is.
 */
export interface ProjectConfig {
  /** Framework hint to bypass auto-detection (e.g., 'nuxt', 'laravel') */
  framework?: string
  /** Free-form project background for the agent */
  context?: string
  /** Rules for deciding which layer a key belongs to */
  layerRules?: Array<{
    layer: string
    description: string
    when: string
  }>
  /** Term dictionary for consistent translations */
  glossary?: Record<string, string>
  /** System prompt for translation requests */
  translationPrompt?: string
  /** Per-locale context (formal register, regional differences, etc.) */
  localeNotes?: Record<string, string>
  /** Few-shot translation examples */
  examples?: Array<Record<string, string>>
  /** Per-layer scan directories and ignore patterns for orphan key detection. Keys are layer names. */
  orphanScan?: Record<string, {
    /** Glob patterns for translation keys to exclude from orphan detection (e.g., "common.datetime.months.*"). */
    ignorePatterns?: string[]
  }>
  /** Default output directory for diagnostic tool reports. Set to true for '.i18n-reports/', or a string for a custom relative path. */
  reportOutput?: string | boolean
  /** Locale directories for the generic adapter. Each entry is a path string (layer="default") or { path, layer } object. */
  localeDirs?: Array<string | { path: string; layer: string }>
  /** Default locale code (required for generic adapter activation). */
  defaultLocale?: string
  /** Explicit list of locale codes. If absent, auto-discovered from files on disk. */
  locales?: string[]
  /** Model preferences for `translate_missing` sampling requests. Overrides the built-in defaults (fast/cheap model bias). */
  samplingPreferences?: {
    /** Ordered model name hints (substring match). First match wins. E.g., ["flash", "haiku"] */
    hints?: string[]
    /** 0 = don't care, 1 = most important factor */
    costPriority?: number
    /** 0 = don't care, 1 = most important factor */
    speedPriority?: number
    /** 0 = don't care, 1 = most important factor */
    intelligencePriority?: number
  }
}

/**
 * The fully resolved i18n configuration for a Nuxt project.
 */
export interface I18nConfig {
  /** Detected framework name (e.g., 'nuxt', 'laravel'). Set by the detector. */
  framework?: string
  /** Absolute path to the project root */
  rootDir: string
  /** Default locale code */
  defaultLocale: string
  /** Fallback locale chain (e.g., { 'de-formal': ['de'], 'default': ['en'] }) */
  fallbackLocale: Record<string, string[]>
  /** All locale definitions */
  locales: LocaleDefinition[]
  /** All discovered locale directories, per layer */
  localeDirs: LocaleDir[]
  /** Root directories of all framework layers/roots. Used for source code scanning. */
  layerRootDirs: string[]
  /** Optional project-specific config from .i18n-mcp.json */
  projectConfig?: ProjectConfig
  /** Locale file format used by this project (default: 'json') */
  localeFileFormat?: LocaleFileFormat
  /** Discovered apps and their layer dependencies. Used for orphan scan scope. */
  apps: AppInfo[]
}
