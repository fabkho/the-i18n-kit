/**
 * Contract tests for the repo-root GitLab CI template: it must stay valid
 * YAML, and I18N_LAYER must be optional in both the translate and cleanup
 * jobs — `--layer` is only ever passed when the variable is non-empty
 * (empty means all layers).
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'

const templatePath = resolve(import.meta.dirname, '../../../../gitlab-ci.yml')

async function loadTemplate(): Promise<{ raw: string, doc: Record<string, any> }> {
  const raw = await readFile(templatePath, 'utf-8')
  return { raw, doc: parse(raw) as Record<string, any> }
}

describe('gitlab-ci.yml template', () => {
  it('parses as YAML with the three reusable jobs', async () => {
    const { doc } = await loadTemplate()
    expect(Object.keys(doc)).toEqual(
      expect.arrayContaining(['.i18n-translate', '.i18n-cleanup', '.i18n-check']),
    )
  })

  it('declares I18N_LAYER as an optional (empty-default) variable in both jobs', async () => {
    const { doc } = await loadTemplate()
    expect(doc['.i18n-translate'].variables.I18N_LAYER).toBe('')
    expect(doc['.i18n-cleanup'].variables.I18N_LAYER).toBe('')
  })

  it('passes --layer only conditionally and never requires I18N_LAYER', async () => {
    const { doc } = await loadTemplate()
    const translateScript = doc['.i18n-translate'].script.join('\n')
    const cleanupScript = doc['.i18n-cleanup'].script.join('\n')

    const conditionalLayer = '[ -n "$I18N_LAYER" ]         && args="$args --layer $I18N_LAYER"'
    expect(translateScript).toContain(conditionalLayer)
    expect(cleanupScript).toContain('[ -n "$I18N_LAYER" ] && args="$args --layer $I18N_LAYER"')

    // No unconditional --layer left anywhere, and the translate job's
    // required-variables check no longer lists I18N_LAYER.
    for (const script of [translateScript, cleanupScript]) {
      for (const line of script.split('\n')) {
        if (line.includes('--layer')) {
          expect(line).toContain('[ -n "$I18N_LAYER" ]')
        }
      }
    }
    expect(translateScript).not.toContain('MISSING I18N_LAYER')
  })

  it('triggers a follow-up MR pipeline after the push, guarded by MR context and an api token', async () => {
    const { doc } = await loadTemplate()
    const translateScript = doc['.i18n-translate'].script.join('\n')

    // The trigger call itself: MR-pipelines endpoint, authenticated with the
    // push token.
    expect(translateScript).toContain(
      '"$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/pipelines"',
    )
    expect(translateScript).toContain('PRIVATE-TOKEN: $I18N_PUSH_TOKEN')
    expect(translateScript).toMatch(/curl\s+--fail-with-body/)

    // Guards: only in merge-request pipelines AND only with a token set.
    expect(translateScript).toContain('[ -n "${CI_MERGE_REQUEST_IID:-}" ]')
    expect(translateScript).toContain('[ -n "${I18N_PUSH_TOKEN:-}" ]')

    // A failed trigger must warn, not fail the job (the push already
    // succeeded) — the curl is followed by an `|| echo "WARN...` fallback.
    expect(translateScript).toMatch(/\|\| echo "WARN: could not trigger/)

    // Without a token there is an explicit notice about the missing head
    // pipeline and how to heal the widget.
    expect(translateScript).toContain('the new head sha has no pipeline')
    expect(translateScript).toContain('Run pipeline')
  })
})
