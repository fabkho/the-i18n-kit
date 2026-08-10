import { resolve } from 'node:path'
import type { I18nConfig } from '../../src/config/types.js'

export const projectRootDir = resolve(import.meta.dirname, '../..')
const playgroundDir = resolve(import.meta.dirname, 'nuxt-project')
const appAdminDir = resolve(playgroundDir, 'app-admin')

const locales = [
  { code: 'de', language: 'de-DE', file: 'de-DE.json' },
  { code: 'en', language: 'en-US', file: 'en-US.json' },
  { code: 'fr', language: 'fr-FR', file: 'fr-FR.json' },
  { code: 'es', language: 'es-ES', file: 'es-ES.json' },
]

const projectConfig = {
  context:
    'This is the test fixture project. It demonstrates a Nuxt app with i18n support, featuring a root layer with shared translations and an app-admin layer with admin-specific translations.',
  layerRules: [
    {
      layer: 'root',
      description:
        'Shared translations used across all apps. Keys like common.actions.*, common.messages.*, common.navigation.*',
      when: "The key is generic enough to be used in multiple apps (e.g., 'Save', 'Cancel', 'Loading...')",
    },
    {
      layer: 'app-admin',
      description:
        'Admin dashboard translations. Keys like admin.*, pages.*, components.* specific to the admin panel.',
      when: 'The key is only relevant to admin functionality',
    },
  ],
  glossary: {
    Buchung: "Booking (never 'Reservation')",
    Ressource: 'Resource (a bookable entity like a room, desk, or person)',
    Termin: 'Appointment',
  },
  translationPrompt:
    'You are translating for a SaaS booking platform. Use professional but approachable tone. Preserve all {placeholders}. Keep translations concise.',
  localeNotes: {
    'de-DE': 'German. Primary language of the platform.',
    'en-US': 'American English.',
    'fr-FR': 'French.',
    'es-ES': 'Spanish.',
  },
  examples: [
    {
      key: 'common.actions.save',
      'de-DE': 'Speichern',
      'en-US': 'Save',
      note: 'Concise, imperative',
    },
  ],
  orphanScan: {
    root: {},
  },
}

/**
 * Fixture config matching what `detectI18nConfig(playgroundDir)` would return.
 *
 * The playground is the root entry-point, so it has a single locale directory
 * under `playground/i18n/locales` with layer name `'root'`.
 */
export function createPlaygroundConfig(): I18nConfig {
  return {
    rootDir: playgroundDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      {
        path: resolve(playgroundDir, 'i18n/locales'),
        layer: 'root',
        layerRootDir: playgroundDir,
      },
    ],
    layerRootDirs: [playgroundDir],
    projectConfig: structuredClone(projectConfig),
    apps: [{ name: 'root', rootDir: playgroundDir, layers: ['root'] }],
  }
}

/**
 * Fixture config for monorepo discovery from the project root (no nuxt.config).
 * Discovers `playground/` as a Nuxt app with i18n. `rootDir` = discovery root.
 */
export function createMonorepoConfig(): I18nConfig {
  return {
    rootDir: projectRootDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      {
        path: resolve(playgroundDir, 'i18n/locales'),
        layer: 'playground',
        layerRootDir: playgroundDir,
      },
    ],
    layerRootDirs: [playgroundDir],
    projectConfig: structuredClone(projectConfig),
    apps: [{ name: 'playground', rootDir: playgroundDir, layers: ['playground'] }],
  }
}
const appShopDir = resolve(playgroundDir, 'app-shop')
const appOutlookDir = resolve(playgroundDir, 'app-outlook')

/**
 * Multi-app fixture: a root layer shared by all apps, app-private layers
 * (`app-admin`, `app-shop`), and an alias entry — `app-outlook` reuses
 * `app-shop`'s locale dir (aliasOf: 'app-shop') and consumes it under the
 * alias name in its app layer list.
 */
export function createMultiAppConfig(): I18nConfig {
  return {
    rootDir: playgroundDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      {
        path: resolve(playgroundDir, 'i18n/locales'),
        layer: 'root',
        layerRootDir: playgroundDir,
      },
      {
        path: resolve(appAdminDir, 'i18n/locales'),
        layer: 'app-admin',
        layerRootDir: appAdminDir,
      },
      {
        path: resolve(appShopDir, 'i18n/locales'),
        layer: 'app-shop',
        layerRootDir: appShopDir,
      },
      {
        path: resolve(appShopDir, 'i18n/locales'),
        layer: 'app-outlook',
        layerRootDir: appOutlookDir,
        aliasOf: 'app-shop',
      },
    ],
    layerRootDirs: [playgroundDir, appAdminDir, appShopDir, appOutlookDir],
    apps: [
      { name: 'app-admin', rootDir: appAdminDir, layers: ['app-admin', 'root'] },
      { name: 'app-shop', rootDir: appShopDir, layers: ['app-shop', 'root'] },
      { name: 'app-outlook', rootDir: appOutlookDir, layers: ['app-outlook', 'root'] },
    ],
  }
}

/**
 * In-memory multi-app config over a temp directory tree: `projectDir` is the
 * root layer's dir and contains nested `app-admin/` and `app-shop/` app dirs.
 * Used by the scope-aware orphan-scan tests, which create real source and
 * locale files under these paths.
 */
export function createTempMultiAppConfig(projectDir: string): I18nConfig {
  const adminDir = resolve(projectDir, 'app-admin')
  const shopDir = resolve(projectDir, 'app-shop')
  return {
    rootDir: projectDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: [{ code: 'de', language: 'de-DE', file: 'de-DE.json' }],
    localeDirs: [
      { path: resolve(projectDir, 'i18n/locales'), layer: 'root', layerRootDir: projectDir },
      { path: resolve(adminDir, 'i18n/locales'), layer: 'app-admin', layerRootDir: adminDir },
      { path: resolve(shopDir, 'i18n/locales'), layer: 'app-shop', layerRootDir: shopDir },
    ],
    layerRootDirs: [projectDir, adminDir, shopDir],
    apps: [
      { name: 'app-admin', rootDir: adminDir, layers: ['app-admin', 'root'] },
      { name: 'app-shop', rootDir: shopDir, layers: ['app-shop', 'root'] },
    ],
  }
}

/**
 * Degenerate fixture without app info (generic/Laravel-style config where
 * no app → layer consumption edges exist).
 */
export function createNoAppsConfig(): I18nConfig {
  return {
    rootDir: playgroundDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      {
        path: resolve(playgroundDir, 'lang'),
        layer: 'default',
        layerRootDir: playgroundDir,
      },
    ],
    layerRootDirs: [playgroundDir],
    apps: [],
  }
}

export function createAppAdminConfig(): I18nConfig {
  return {
    rootDir: appAdminDir,
    defaultLocale: 'de',
    fallbackLocale: { default: ['en'] },
    locales: structuredClone(locales),
    localeDirs: [
      {
        path: resolve(appAdminDir, 'i18n/locales'),
        layer: 'root',
        layerRootDir: appAdminDir,
      },
      {
        path: resolve(playgroundDir, 'i18n/locales'),
        layer: 'playground',
        layerRootDir: playgroundDir,
      },
    ],
    layerRootDirs: [appAdminDir, playgroundDir],
    projectConfig: structuredClone(projectConfig),
    apps: [
      { name: 'root', rootDir: appAdminDir, layers: ['root', 'playground'] },
    ],
  }
}
