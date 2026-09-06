import type { I18nConfig, ProjectConfig } from '../config/types'

export type LocaleFileFormat = 'json' | 'php-array' | 'yaml'

export interface FrameworkAdapter {
  readonly name: string
  readonly label: string
  readonly localeFileFormat: LocaleFileFormat
  detect(projectDir: string): Promise<number>
  /**
   * The project's own declaration is passed in rather than loaded here: it
   * walks ancestors, parses JSON and executes a TypeScript config, and every
   * adapter — the Nuxt one once per app — used to repeat all of that for the
   * same answer. `null` means the project declares nothing.
   */
  resolve(projectDir: string, projectConfig: ProjectConfig | null): Promise<I18nConfig>
}
