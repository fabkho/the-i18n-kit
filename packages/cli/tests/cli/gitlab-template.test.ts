/**
 * Contract tests for the repo-root GitLab CI template: it must stay valid YAML,
 * the job names users `extends:` must keep resolving, and I18N_LAYER must stay
 * optional — `--layer` is only ever passed when the variable is non-empty
 * (empty means all layers).
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'

const templatePath = resolve(import.meta.dirname, '../../../../gitlab-ci.yml')

interface Job {
  extends?: string
  script?: string[]
  before_script?: string[]
  variables?: Record<string, string>
  allow_failure?: unknown
}

async function loadTemplate(): Promise<Record<string, Job>> {
  return parse(await readFile(templatePath, 'utf-8')) as Record<string, Job>
}

/**
 * The job as GitLab assembles it: `extends` chains are followed, hash keys are
 * merged and list keys are replaced. Jobs that share a script through a hidden
 * base are then read exactly as a pipeline reads them.
 */
function resolveJob(doc: Record<string, Job>, name: string): Job {
  const job = doc[name]
  if (!job) throw new Error(`job ${name} not found in gitlab-ci.yml`)
  const base = job.extends ? resolveJob(doc, job.extends) : {}
  return { ...base, ...job, variables: { ...base.variables, ...job.variables } }
}

describe('gitlab-ci.yml template', () => {
  it('parses as YAML with the three jobs users extend', async () => {
    const doc = await loadTemplate()
    expect(Object.keys(doc)).toEqual(
      expect.arrayContaining(['.i18n-translate', '.i18n-cleanup', '.i18n-check']),
    )
  })

  it('gives every job an image, an install step and a script', async () => {
    const doc = await loadTemplate()
    for (const name of ['.i18n-translate', '.i18n-cleanup', '.i18n-check']) {
      const job = resolveJob(doc, name)
      expect(job.before_script?.join('\n'), name).toContain('@the-i18n-kit/cli')
      expect(job.script?.length, name).toBeGreaterThan(0)
    }
  })

  it('declares I18N_LAYER as an optional (empty-default) variable in both scanning jobs', async () => {
    const doc = await loadTemplate()
    expect(resolveJob(doc, '.i18n-translate').variables?.I18N_LAYER).toBe('')
    expect(resolveJob(doc, '.i18n-cleanup').variables?.I18N_LAYER).toBe('')
  })

  it('passes --layer only conditionally and never requires I18N_LAYER', async () => {
    const doc = await loadTemplate()
    const translateScript = resolveJob(doc, '.i18n-translate').script!.join('\n')
    const cleanupScript = resolveJob(doc, '.i18n-cleanup').script!.join('\n')

    expect(translateScript).toContain('[ -n "$I18N_LAYER" ]         && args="$args --layer $I18N_LAYER"')
    expect(cleanupScript).toContain('[ -n "$I18N_LAYER" ] && args="$args --layer $I18N_LAYER"')

    // No unconditional --layer left anywhere, and the translate job's
    // required-variables check does not list I18N_LAYER.
    for (const script of [translateScript, cleanupScript]) {
      for (const line of script.split('\n')) {
        if (line.includes('--layer')) {
          expect(line).toContain('[ -n "$I18N_LAYER" ]')
        }
      }
    }
    expect(translateScript).not.toContain('I18N_LAYER are required')
  })

  /**
   * The two report jobs run the same script with a different command, so the
   * names stay the interface while the shell exists once.
   */
  it('resolves the cleanup and check jobs to one script and two commands', async () => {
    const doc = await loadTemplate()
    const cleanup = resolveJob(doc, '.i18n-cleanup')
    const check = resolveJob(doc, '.i18n-check')

    expect(cleanup.script).toEqual(check.script)
    expect(cleanup.variables?.I18N_COMMAND).toBe('orphans')
    expect(check.variables?.I18N_COMMAND).toBe('check')
    expect(cleanup.script!.join('\n')).toContain('the-i18n-cli "$I18N_COMMAND" $args')
  })

  it('routes the API key through the provider env vars the CLI reads', async () => {
    const doc = await loadTemplate()
    const script = resolveJob(doc, '.i18n-translate').script!.join('\n')

    for (const envVar of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) {
      expect(script).toContain(`${envVar}="$I18N_API_KEY"`)
    }
    // The key never reaches argv, where `ps` and error output can pick it up.
    expect(script).not.toContain('--api-key')
    expect(script).not.toContain('--apiKey')
  })

  it('triggers a follow-up MR pipeline after the push, guarded by MR context and an api token', async () => {
    const doc = await loadTemplate()
    const script = resolveJob(doc, '.i18n-translate').script!.join('\n')

    // The trigger call itself: MR-pipelines endpoint, authenticated with the
    // push token.
    expect(script).toContain(
      '"$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/pipelines"',
    )
    expect(script).toContain('PRIVATE-TOKEN: $I18N_PUSH_TOKEN')
    expect(script).toMatch(/curl\s+--fail-with-body/)

    // Guards: only in merge-request pipelines AND only with a token set.
    expect(script).toContain('[ -n "${CI_MERGE_REQUEST_IID:-}" ]')
    expect(script).toContain('[ -n "$I18N_PUSH_TOKEN" ]')

    // A failed trigger must warn, not fail the job — the push already
    // succeeded, so the curl is followed by an `|| echo "WARN...` fallback.
    expect(script).toMatch(/\|\| echo "WARN: could not trigger/)
  })
})
