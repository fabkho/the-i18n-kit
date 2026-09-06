# Writing docs for the-i18n-kit

> Canonical house style for the documentation site. The `i18n-kit-docs` skill
> under `.claude/skills/` points here — `.claude/` is gitignored, so it cannot
> be shared with contributors or CI.

House style, derived from the Nuxt documentation style guide and adapted to this
project's positioning. Follow it exactly — the site's value depends on forty
pages reading as though one person wrote them.

## Who you are writing for

Two audiences, in this order:

1. **Someone whose AI agent will use this.** They care whether the tool respects
   a context window and whether its output is machine-readable. They skim.
2. **Someone maintaining i18n in a large monorepo.** They care about layers,
   shared libraries and not deleting a key that turns out to be in use. They
   read closely and distrust confident claims.

A third group — small single-locale projects — is welcome but not the target.
Never pretend otherwise. Honesty about fit buys credibility for everything else.

## Voice

- **Second person.** "You configure", not "the user configures" or "we configure".
- **Active voice.** "The scanner reports the key", not "the key is reported".
- **Present tense** for behaviour. "The CLI exits non-zero", not "will exit".
- Friendly and direct. Personality is fine; clarity wins any conflict.
- Assume competence and diverse backgrounds. Never talk down.

### Banned

- **"Simply", "just", "obviously", "of course", "easy".** They tell a stuck
  reader the fault is theirs. Delete the word; the sentence is usually already
  correct. Not "simply make sure the config returns an object" — "make sure the
  config returns an object".
- **Marketing adjectives with nothing behind them** — "powerful", "seamless",
  "blazing fast", "revolutionary". State the mechanism instead. Not "powerful
  orphan detection" but "reports which apps consume a layer before calling a key
  unused".
- **"Wrapper"** for the MCP server in reader-facing prose. It is accurate
  internally and undersells externally. On the architecture page, say the MCP
  server depends on the CLI package and explain what that buys the reader:
  identical results from terminal and agent.
- **Emoji in body prose.** Callout components carry their own icons.
- **Future-tense roadmap talk inside reference pages.** If it does not ship, it
  does not belong outside the roadmap page.

## Vocabulary

Use these exact terms. Consistency across pages is what makes the vocabulary
learnable.

| Term | Means | Notes |
|---|---|---|
| **layer** | A scoped locale directory | Defined once, framework-neutrally, on [Layers and the Consumer Graph](/monorepos/layers-and-consumer-graph). Every other page uses the word and links there. Do not restate the definition. |
| **consumer graph** | Which apps consume which layers | The thing that makes usage evidence app-scoped. |
| **adapter** | Per-framework detection and resolution | Not "plugin", not "driver". |
| **surface** | CLI, MCP server, Nuxt module, ESLint plugin, CI integrations | Five surfaces, one engine. |
| **orphan key** | Defined, with no usage evidence in any consuming app | Only orphans are ever removed. |
| **uncertain key** | Ambiguous evidence | Never removed. Say so every time it appears. |
| **misplaced usage** | Used only from a non-consuming app | Reported, never removed. |
| **provider mode / agent mode** | Translation modes | Always name the mode explicitly. |
| **gate** | A flag making the CLI exit non-zero on findings | A gate tripping is not a failure — distinguish the two exit codes. |
| **derived config** | Read out of a framework's own config file | As opposed to **declared config**, written by a person. |

**Package names are always the scoped ones** — `@the-i18n-kit/cli`,
`@the-i18n-kit/mcp`, `@the-i18n-kit/nuxt`. The binary a user types is unchanged.
Unscoped names appear only where documenting the deprecation itself.

## Page structure

Modelled on the Vue documentation, which is the closest thing to a house
reference for how a page should read.

### Open with content

**No description subtitle.** Put the sentence in `seo:` frontmatter, where it
feeds the meta tag without rendering under the heading:

```mdc
---
title: Referring to Locales
seo:
  description: Codes, language tags and file names, and why the code is the one to use.
---
```

A bare `description:` renders as a subtitle. Nobody reads it — they have already
read the title, and it says the same thing twice.

**No paragraph describing the page.** Vue's props page opens with a prerequisite
and then props. Its reactivity page opens with `data`. Neither spends a sentence
on what the page is going to do.

Delete these on sight:

- *"This page tells you whether…"*
- *"This page covers…"* / *"In this guide we will…"*
- *"This page is about location, not fields."*

Open with the first thing the reader needs. If a prerequisite genuinely matters,
state it in one line and move on.

### Show, then explain

Vue puts the code first and the explanation after it. Do the same: the command
or config a reader will copy, then what it does. A concept that cannot be shown
gets its shortest true statement first, and the reasoning after.

Paragraphs run two to four sentences.

### Leave the internals out

**The default is to omit.** A reader wants the tool to work; how it decides
something is rarely part of that.

Cut, unless a reader has to act on it:

- how detection scores or ranks
- how a graph, cache or resolver is built
- why an implementation chose one approach over another
- what happens in a degenerate case nobody will hit

Keep it **only** when the reader has to do something with it — pin a locale,
declare an ignore pattern, choose between two config files. Then state the
consequence, not the mechanism: *"pin `defaultLocale` if the wrong one is
picked"* rather than a paragraph on how the pick happens.

Where the depth has nowhere to go, it goes nowhere. There is no Extra Topics
section: material a reader cannot act on is deleted, not relocated.

### State behavior, not claims

Not "safe by default" — "`orphans` reports; nothing is deleted without
`--remove`." Not "great for agents" — "a large report goes to a file and the
caller gets a summary." Never name a function, module or file the reader cannot
call.

### State a limit where it changes what the reader does

There is no mandatory `## Limits` section. A limit belongs inline at the point of
decision, in the sentence that tells the reader what to do about it. A limit with
no decision attached is deleted.

### Budget

A guide page targets 400 words and caps at 700. Over the cap, either the page is
two pages or half of it is stated somewhere else already.

### One canonical home

Exit codes, gate flags, `failed` and `skipped` reason sets, the translate
invariant, output diversion, the error shape and the environment variables live
on [the agent contract](/getting-started/agent-contract) and nowhere else. Agent
mode versus provider mode lives on
[Translation Modes](/concepts/translation-modes). Every other page links; no
other page restates.

## Formatting

Inline code for filenames, paths, package names, config keys, commands, flags,
tool names and identifiers: `i18n-kit.config.ts`, `@the-i18n-kit/cli`,
`--fail-under`, `find_orphan_keys`.

Code blocks carry a language and, where a file is implied, a filename label:

````mdc
```ts [i18n-kit.config.ts]
import { defineI18nKitConfig } from '@the-i18n-kit/cli/config'

export default defineI18nKitConfig({
  defaultLocale: 'en',
})
```
````

Examples must be copy-pasteable: real imports, no mid-code ellipses, no
placeholder that silently fails. If a value must be substituted, make it obvious
(`<your-api-key>`) and say so underneath.

**Headings** use Chicago title case, except code identifiers, which keep their
own casing. **Links** are relative and without a domain. **Tables** for anything
with parallel structure across three or more items — flags, config fields,
comparisons. Prose for reasoning; tables for lookup.

**American English** throughout: behavior, customize, initialize.

## MDC components

```mdc
::note
Neutral aside. Use sparingly.
::

::tip
A better way to do the thing just described.
::

::warning
Something that costs the reader time or data if ignored. Deletion, overwriting,
CI going green on a broken run.
::
```

Prop syntax is `::component{key="value"}` inline, or a `---` YAML block inside
the component for anything longer. Named slots use `#slot-name`.

Verify exact component names and props against the installed Docus version
before using anything beyond the three above — do not assume a component exists
because another docs site has it.

Two callouts on a page is usually one too many. If everything is highlighted,
nothing is.

## Accuracy

- **Verify every command, flag, tool name and config field against the shipped
  source before writing it.** This project's documentation has drifted from its
  implementation repeatedly; that is the reason the site exists.
- Never document behaviour you have not confirmed. An honest gap beats a
  confident error.
- Where a generated reference already documents something, **link to it rather
  than restating it**. Restating is how the READMEs ended up contradicting each
  other.
- Do not describe unreleased behaviour. If a change is in flight, leave the page
  out rather than guessing at where it lands.

## Before you finish

- [ ] No description subtitle — the sentence is under `seo:`
- [ ] Opens with content, not with a description of the page
- [ ] No banned words; no unbacked adjectives
- [ ] Behavior stated, not claimed
- [ ] No private identifier in prose — nothing the reader cannot call
- [ ] No issue links; no "previously", "earlier" or "no longer"; no rationale for
      an implementation choice
- [ ] Nothing on this page is stated on another page
- [ ] Vocabulary matches the table above; "layer" is linked, not redefined
- [ ] Package names are scoped
- [ ] Every command, flag and field verified against source
- [ ] Code blocks are labelled, copy-pasteable and complete
- [ ] Links are relative; every target exists as a page path
- [ ] Reference material is linked, not restated
- [ ] Limits stated where they change a decision, and nowhere else
- [ ] Under 700 words
- [ ] Read once end to end — does it sound like the rest of the site?
