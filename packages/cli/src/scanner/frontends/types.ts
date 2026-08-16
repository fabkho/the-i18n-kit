import type { DynamicKeyUsage, KeyUsage } from '../code-scanner.js'

/**
 * What a frontend saw at one call site, before anything decides what it means.
 *
 * Frontends read their own language with whatever parser suits it and report
 * call sites in these terms. The rules that turn them into usages, dynamic
 * keys and candidates live in one place above this, so adding a language never
 * means restating what counts as a translation (#332).
 */
export interface CallSite {
  /** The callee as written — `t`, `$t`, `__`, `trans_choice`. */
  callee: string

  /**
   * Whether the frontend could prove this callee is the i18n function.
   *
   * `resolved` means it followed the identifier to an import from an i18n
   * package or a destructure of `useI18n()`. `ambiguous` means it recognised
   * the shape but cannot say what the name is bound to — all a regex can ever
   * report, and the reason the dot heuristic exists at all.
   */
  binding: 'resolved' | 'ambiguous'

  argument: CallArgument

  line: number
}

export type CallArgument =
  /** A literal: `t('common.save')`. */
  | { kind: 'static', value: string }
  /** An interpolated template, already normalised to `${_}` slots. */
  | { kind: 'template', expression: string }
  /** A literal prefix joined to something else: `t('common.' + name)`. */
  | { kind: 'concat', prefix: string }
  /** Something the frontend could not read — a variable, a call, a ternary. */
  | { kind: 'unknown' }

/** Everything one file yields. Unchanged from what the scanner already consumes. */
export interface FileEvidence {
  usages: KeyUsage[]
  dynamicKeys: DynamicKeyUsage[]
  bareStringCandidates: Set<string>
}

export interface LanguageFrontend {
  /** For diagnostics and for the differential harness. */
  readonly name: string

  /** Whether this frontend reads that file. */
  handles(filePath: string): boolean

  /**
   * Read a file into call sites, or return null to decline it — a syntax the
   * parser cannot handle, a missing optional dependency. Declining is not an
   * error: the caller falls back to the frontend that always works.
   */
  read(content: string, filePath: string): Promise<CallSite[] | null>
}
