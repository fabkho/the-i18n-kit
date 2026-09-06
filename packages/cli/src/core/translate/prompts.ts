/**
 * Prompt construction for the translate operations: the provider-mode system
 * and user messages, plus the agent-mode fallback context that carries the
 * same project instructions to a host agent.
 */

import type { ProjectConfig } from '../../config/types.js'
import type { LocaleFileFormat } from '../../adapters/types.js'

function placeholderInstruction(format?: LocaleFileFormat): string {
  if (format === 'php-array') {
    return 'Preserve all :placeholder parameters exactly as-is.'
  }
  return 'Preserve all {placeholder} parameters and @:linked.message references.'
}

export function buildTranslationSystemPrompt(
  projectConfig: ProjectConfig | undefined,
  targetLocaleCode: string,
  localeFileFormat?: LocaleFileFormat,
): string {
  const parts: string[] = [
    `You are a professional translator for software UI strings. ${placeholderInstruction(localeFileFormat)} Be concise — UI space is limited.`,
  ]

  if (projectConfig?.translationPrompt) {
    parts.push(projectConfig.translationPrompt)
  }

  if (projectConfig?.glossary && Object.keys(projectConfig.glossary).length > 0) {
    const glossaryLines = Object.entries(projectConfig.glossary)
      .map(([term, definition]) => `- ${term} → ${definition}`)
      .join('\n')
    parts.push(`GLOSSARY — use these terms consistently:\n${glossaryLines}`)
  }

  if (projectConfig?.localeNotes?.[targetLocaleCode]) {
    parts.push(`TARGET LOCALE NOTE (${targetLocaleCode}): ${projectConfig.localeNotes[targetLocaleCode]}`)
  }

  if (projectConfig?.examples && projectConfig.examples.length > 0) {
    const exampleLines = projectConfig.examples
      .map((ex) => {
        const pairs = Object.entries(ex)
          .filter(([k]) => k !== 'key' && k !== 'note')
          .map(([locale, val]) => `${locale}: "${val}"`)
          .join(', ')
        const note = ex.note ? ` (${ex.note})` : ''
        return `- ${ex.key}: ${pairs}${note}`
      })
      .join('\n')
    parts.push(`STYLE EXAMPLES:\n${exampleLines}`)
  }

  parts.push('Return ONLY a JSON object mapping keys to translated values. No markdown, no explanation, no code fences.')

  return parts.join('\n\n')
}

export function buildTranslationUserMessage(
  referenceLocaleCode: string,
  targetLocaleCode: string,
  keysAndValues: Record<string, string>,
  localeFileFormat?: LocaleFileFormat,
): string {
  return [
    `Translate the following i18n key-value pairs from ${referenceLocaleCode} to ${targetLocaleCode}.`,
    placeholderInstruction(localeFileFormat),
    '',
    JSON.stringify(keysAndValues),
  ].join('\n')
}

/**
 * The agent-mode counterpart of the prompt builders: everything a host agent
 * needs to translate the batch itself and write it back.
 */
export function buildFallbackContext(
  projectConfig: ProjectConfig | undefined,
  referenceLocaleCode: string,
  targetLocaleCode: string,
  keysAndValues: Record<string, string>,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    instruction: `Translate these keys from ${referenceLocaleCode} to ${targetLocaleCode}, then call write_translations (mode: 'upsert') to write them.`,
    referenceLocale: referenceLocaleCode,
    targetLocale: targetLocaleCode,
    keysToTranslate: keysAndValues,
  }

  if (projectConfig?.translationPrompt) {
    context.translationPrompt = projectConfig.translationPrompt
  }
  if (projectConfig?.glossary && Object.keys(projectConfig.glossary).length > 0) {
    context.glossary = projectConfig.glossary
  }
  if (projectConfig?.localeNotes?.[targetLocaleCode]) {
    context.localeNote = projectConfig.localeNotes[targetLocaleCode]
  }
  if (projectConfig?.examples && projectConfig.examples.length > 0) {
    context.examples = projectConfig.examples
  }

  return context
}
