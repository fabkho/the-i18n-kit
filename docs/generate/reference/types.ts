/**
 * The contract between the loaders that read sources off disk and the pure
 * builder that turns them into pages.
 *
 * Nothing here imports from the packages. The builder is handed already-loaded
 * data so that its tests can supply fixtures instead of a repository, and so
 * that the remaining reference sources (MCP tools, config schema, action
 * inputs) can be added as further fields on `ReferenceSources` without the
 * builder growing a filesystem dependency.
 */

/**
 * A citty `ArgDef`, narrowed to the fields the reference reads.
 *
 * Structural rather than imported: the builder must stay usable from a test
 * fixture, and citty's own type carries a discriminated union that makes a
 * hand-written fixture noisy for no gain here.
 */
export interface ArgDefLike {
  type?: string
  description?: string
  required?: boolean
  default?: unknown
  alias?: string | string[]
  valueHint?: string
}

/**
 * A gate the shared command factory evaluates, as retained on the definition.
 * A spec with no `flag` is always evaluated: the run still succeeds, and the
 * gate trips on what it found without having been asked to.
 */
export interface GateSpecLike {
  flag?: string
  name?: string
  counter: string
  direction?: string
  threshold?: number
}

/** A citty `CommandDef`, narrowed to the fields the reference reads. */
export interface CommandDefLike {
  meta?: { name?: string, description?: string }
  args?: Record<string, ArgDefLike>
  /** Retained by `createCommand`. Absent on hand-written definitions. */
  gates?: GateSpecLike[]
  /**
   * The handler. Never called — its identity is what distinguishes a genuine
   * command from an alias of one.
   */
  run?: unknown
}

/** One entry of the command registry, with its lazy loader already resolved. */
export interface CliCommandEntry {
  /** The registry key, which is the name a user types. */
  name: string
  def: CommandDefLike
}

/** The three exit codes the shared command factory assigns. */
export interface ExitCodeValues {
  success: number
  runFailed: number
  gateTripped: number
}

export interface CliSource {
  /** Registry order. Aliases are still present as their own entries. */
  entries: CliCommandEntry[]
  /**
   * The registry names the CLI actually exposes as subcommands. Anything
   * registered but absent from this list is documented as unreachable rather
   * than quietly published as though it worked.
   */
  exposed: readonly string[]
  exitCodes: ExitCodeValues
}

/** Every loaded source the builder renders from. */
export interface ReferenceSources {
  cli: CliSource
}

/**
 * Output paths are relative to `docs/content`, so the builder never needs to
 * know where the content directory lives.
 */
export type ReferenceOutput = Map<string, string>

/** One flag, as the reference renders it. */
export interface ArgDoc {
  /**
   * The declared name, which is what the flag looks like in `--help`:
   * `dryRun` renders as `--dryRun`. citty registers the kebab-case form as an
   * alias, so `--dry-run` works too; the overview says so once.
   */
  name: string
  type: string
  description: string
  required: boolean
  default: unknown
  alias: string[]
  valueHint?: string
}

/** A second registry name for a command that already has a page. */
export interface AliasDoc {
  name: string
  description: string
}

/** One command, with its aliases folded in. */
export interface CommandDoc {
  name: string
  description: string
  /** Every declared flag, shared ones included. The builder does the split. */
  args: ArgDoc[]
  /** False when the registry holds the command but the CLI does not expose it. */
  aliases: AliasDoc[]
  /** The gates the factory evaluates for this command, flagged or always on. */
  gates: GateSpecLike[]
}
