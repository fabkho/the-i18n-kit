import type { I18nConfig } from '../config/types'

export type LocaleFileFormat = 'json' | 'php-array'

export interface FrameworkAdapter {
  readonly name: string
  readonly label: string
  readonly localeFileFormat: LocaleFileFormat
  detect(projectDir: string): Promise<number>
  resolve(projectDir: string): Promise<I18nConfig>
}
