/**
 * Renders the CLI reference: one overview page carrying everything true of
 * every command, and one page per command carrying only what is distinctive
 * about it.
 */

import { alwaysOnGates, buildCliModel, gateArgs, specificArgs } from './cli-model.js'
import { GENERATED_NOTICE, cell, code, frontmatter, page, prose, table, textCell } from './markdown.js'
import type { ArgDoc, CliSource, CommandDoc, ExitCodeValues, ReferenceOutput } from './types.js'

/** Directory under `docs/content`. The numeric prefixes are stripped from routes. */
const DIR = '9.reference/1.cli'
/** The route the pages link to each other by. */
const ROUTE = '/reference/cli'

const BINARY = 'the-i18n-cli'
const PACKAGE = '@the-i18n-kit/cli'

export function renderCliReference(source: CliSource): ReferenceOutput {
  const model = buildCliModel(source)
  const output: ReferenceOutput = new Map()

  output.set(`${DIR}/index.md`, renderOverview(model.commands, model.sharedArgs, source.exitCodes))
  for (const command of model.commands) {
    output.set(`${DIR}/${command.name}.md`, renderCommand(command, model.sharedArgs))
  }

  return output
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function renderOverview(
  commands: CommandDoc[],
  shared: ArgDoc[],
  exitCodes: ExitCodeValues,
): string {
  return page([
    frontmatter({
      title: 'CLI Commands',
      description: `Every command ${PACKAGE} registers, the flags they all share, and the exit codes that tell a tripped gate apart from a failed run.`,
    }),
    GENERATED_NOTICE,
    '# CLI Commands',
    `Every command ${code(PACKAGE)} registers is listed below and documented on its own page. Every one of them accepts the [shared flags](#shared-flags) and sets one of the [exit codes](#exit-codes) below, so the command pages carry only what is distinctive about each.`,
    '## Commands',
    commandTable(commands),
    ...aliasSection(commands),
    '## Shared Flags',
    argTable(shared),
    '## Flag Name Forms',
    `Flags are declared in camel case and print that way in ${code(`${BINARY} <command> --help`)}, which is the form used throughout this reference. citty registers the kebab-case form as an alias, so ${code('--dryRun')} and ${code('--dry-run')} are the same flag.`,
    '## Exit Codes',
    exitCodeTable(exitCodes),
    `A gate tripping is not a run failing. Exit ${exitCodes.gateTripped} means the command did its job and found something you asked it to fail on — missing keys, orphans, coverage below a floor. Exit ${exitCodes.runFailed} means the run itself fell over, and its counters say nothing about your project. A failed run outranks a tripped gate: gates are not consulted at all when the run failed.`,
    '## CI Gates',
    `Gates are opt-in, with one exception. Without one of these flags a command reports its findings and exits ${exitCodes.success}, so failing a build on findings is something you ask for rather than something you discover. The exception is a gate marked "always on": its findings are a defect rather than a threshold, so there is nothing to opt into.`,
    gateTable(commands),
    ...gateReportNote(exitCodes),
  ])
}

function commandTable(commands: CommandDoc[]): string {
  const rows = commands.map(command => [
    `[${code(command.name)}](${ROUTE}/${command.name})`,
    textCell(command.description),
  ])
  return table(['Command', 'What it does'], rows)
}

function aliasSection(commands: CommandDoc[]): string[] {
  const rows = commands.flatMap(command =>
    command.aliases.map(alias => [
      code(alias.name),
      `[${code(command.name)}](${ROUTE}/${command.name})`,
      textCell(alias.description),
    ]),
  )
  if (rows.length === 0) return []
  return [
    '## Aliases',
    'These names run a command documented above. They get no page of their own, because they take the same flags and produce the same result.',
    table(['Name', 'Runs', 'Why it exists'], rows),
  ]
}


function exitCodeTable(exitCodes: ExitCodeValues): string {
  const rows = [
    [String(exitCodes.success), 'The run succeeded and no gate tripped.'],
    [String(exitCodes.runFailed), 'The run itself failed — an unusable API key, an unreadable project, a translate call that produced nothing.'],
    [String(exitCodes.gateTripped), 'The run succeeded and a gate tripped — one you requested, or one the command always evaluates. The findings are real; the tool worked.'],
  ]
  return table(['Code', 'Means'], rows)
}

function gateTable(commands: CommandDoc[]): string {
  const rows = commands.flatMap((command) => {
    const link = `[${code(command.name)}](${ROUTE}/${command.name})`
    return [
      // textCell, not cell: a description containing <angle brackets> is parsed
      // as an HTML tag otherwise, and the rest of the cell disappears.
      ...gateArgs(command).map(arg => [link, code(`--${arg.name}`), textCell(arg.description)]),
      // No flag to name, so the trip condition is stated from the spec itself.
      ...alwaysOnGates(command).map(gate => [
        link,
        'always on',
        `${code(`summary.${gate.counter}`)} is ${gate.direction === 'below' ? 'below' : 'above'} ${code(String(gate.threshold ?? 0))}`,
      ]),
    ]
  })
  return table(['Command', 'Flag', 'Trips when'], rows)
}

function gateReportNote(exitCodes: ExitCodeValues): string[] {
  return [
    `When a gate trips, the result gains a ${code('gatesTripped')} array naming each gate, the counter it read, the threshold it was held to and the value it observed. A run where nothing tripped is byte-for-byte what it was before gates existed, so a consumer parsing the result needs no change to tolerate them.`,
    ['::note',
      `A gate marked "always on" needs no flag: its findings are a defect rather `
      + `than a threshold you opt into caring about. It still reports as a gate — `
      + `exit ${exitCodes.gateTripped} with a ${code('gatesTripped')} entry — so a `
      + `finding stays distinguishable from the run itself failing with exit `
      + `${exitCodes.runFailed}.`,
      '::'].join('\n'),
  ]
}

// ---------------------------------------------------------------------------
// One command
// ---------------------------------------------------------------------------

function renderCommand(command: CommandDoc, shared: ArgDoc[]): string {
  const specific = specificArgs(command, shared)
  return page([
    frontmatter({ title: command.name, description: command.description }),
    GENERATED_NOTICE,
    prose(command.description),
    '## Synopsis',
    synopsis(command),
    '## Flags',
    ...flagsSection(command, specific),
    ...commandAliasNote(command),
  ])
}


function synopsis(command: CommandDoc): string {
  const required = command.args
    .filter(arg => arg.required)
    .map(arg => `--${arg.name} <${arg.valueHint ?? arg.name}>`)
  const parts = [BINARY, command.name, ...required]
  return ['```bash', parts.join(' '), '```'].join('\n')
}

function flagsSection(command: CommandDoc, specific: ArgDoc[]): string[] {
  if (specific.length === 0) {
    return [`${code(command.name)} declares no flags of its own.`]
  }
  return [argTable(specific)]
}

function commandAliasNote(command: CommandDoc): string[] {
  if (command.aliases.length === 0) return []
  const names = command.aliases.map(alias => code(`${BINARY} ${alias.name}`)).join(', ')
  const reasons = command.aliases.map(alias => prose(alias.description)).join(' ')
  return ['## Other Names', `${names} runs this same command with the same flags. ${reasons}`]
}

// ---------------------------------------------------------------------------
// Flag table
// ---------------------------------------------------------------------------

function argTable(args: ArgDoc[]): string {
  const rows = args.map(arg => [
    flagNames(arg),
    code(arg.type),
    arg.required ? 'yes' : 'no',
    formatDefault(arg),
    textCell(arg.description),
  ])
  return table(['Flag', 'Type', 'Required', 'Default', 'Description'], rows)
}

/**
 * The flag, its accepted values where the definition hints at them, and the
 * other spellings that reach it.
 *
 * A one-character alias is a short flag (`-d`); a longer one is a long flag
 * (`--ref`), which is what a flag renamed to match its MCP parameter keeps
 * working under. citty's own usage text prints every alias with a single dash,
 * so following it here would document a form the parser never accepts.
 */
function flagNames(arg: ArgDoc): string {
  const hint = arg.valueHint === undefined ? '' : `=<${arg.valueHint}>`
  const aliases = arg.alias.map(alias => code(alias.length === 1 ? `-${alias}` : `--${alias}`))
  return [code(cell(`--${arg.name}${hint}`)), ...aliases].join(', ')
}

function formatDefault(arg: ArgDoc): string {
  if (arg.default === undefined) return '—'
  return code(JSON.stringify(arg.default))
}
