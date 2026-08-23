import type { CallSite, FileEvidence } from './frontends/types.js'

/**
 * What counts as a translation.
 *
 * One definition for every language. Frontends report what they saw in their
 * own terms; this decides what it means, so adding a parser never means
 * restating the semantics (#332).
 */

export interface RuleContext {
  filePath: string
  /**
   * Whether a dotless key from an *ambiguous* callee should be treated as
   * evidence of use.
   *
   * A bare `t('word')` is ambiguous — `emit('save')` is not a translation — so
   * it is not counted as a usage. Dropping it entirely was worse: a flat
   * catalogue's keys then look unreferenced and remove-orphans offers a live
   * key for deletion (#298). It becomes a candidate, which protects a key only
   * when one of that exact name exists.
   *
   * A frontend that *resolved* the binding is exempt: it knows the call is
   * i18n, so the dot tells it nothing it does not already know. That exemption
   * is the whole reason for parsing rather than matching.
   */
  ambiguousCalleeNeedsDot: (callee: string) => boolean
}

/**
 * The one callee whose dotless arguments are not evidence: a bare `t` is what
 * `emit`, test helpers and local functions are also called. Every other name
 * the pattern sets match (`$t`, `__`, `trans`, ...) is distinctive enough that
 * its argument counts, dot or no dot. Formerly per-pattern-set configuration;
 * it is a rule about meaning, so it lives with the rules.
 */
export const ambiguousCalleeNeedsDot = (callee: string): boolean => callee === 't'

export function interpret(sites: CallSite[], ctx: RuleContext): FileEvidence {
  const usages: FileEvidence['usages'] = []
  const dynamicKeys: FileEvidence['dynamicKeys'] = []
  const bareStringCandidates = new Set<string>()

  for (const site of sites) {
    const { callee, line, argument } = site
    const guarded = site.binding === 'ambiguous' && ctx.ambiguousCalleeNeedsDot(callee)

    switch (argument.kind) {
      case 'static': {
        if (guarded && !argument.value.includes('.')) {
          bareStringCandidates.add(argument.value)
          break
        }
        usages.push({ key: argument.value, file: ctx.filePath, line, callee })
        break
      }

      case 'template': {
        dynamicKeys.push({ expression: `\`${argument.expression}\``, file: ctx.filePath, line, callee })
        break
      }

      case 'concat': {
        // The prefix bounds what the call can produce; everything after it is
        // unknown, so it becomes a slot.
        if (guarded && !argument.prefix.includes('.')) break
        dynamicKeys.push({ expression: `\`${argument.prefix}\${_}\``, file: ctx.filePath, line, callee })
        break
      }

      case 'unknown':
        // A key the frontend could not read is not evidence either way. The
        // bare-candidate net, which reads strings from anywhere in the file,
        // is what protects keys reached this way.
        break
    }
  }

  return { usages, dynamicKeys, bareStringCandidates }
}
