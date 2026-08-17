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
| **layer** | A scoped locale directory | **Define framework-neutrally on first use in any page that leans on it**: a Nuxt layer, a workspace package, a shared UI library, or an app in a monorepo. Readers on React or Laravel abandon the page if it reads as Nuxt-only. |
| **consumer graph** | Which apps consume which layers | The thing that makes usage evidence app-scoped. |
| **adapter** | Per-framework detection and resolution | Not "plugin", not "driver". |
| **surface** | CLI, MCP server, Nuxt module, CI integrations | Four surfaces, one engine. |
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

Every page opens with **one or two sentences stating what the reader will be
able to do or understand**, before any heading. No throat-clearing, no restating
the title.

Then, by page type:

**Concept page** — what it is, why it works that way, what it cannot do. Lead
with the mental model, not the API. Introduce jargon in bold on first use with
its definition attached. End with limits, honestly stated; a concept page that
lists no limits reads as marketing.

**Guide / how-to** — numbered steps, each with a verifiable outcome. The reader
should know after every step whether it worked. Close with what to do next.

**Framework page** — how detection recognises the project; which directories are
probed; what is derived from which file; how to override. Same section order on
every framework page so they can be compared at a glance.

**Reference page** — generated. Do not hand-edit. Fix the generator instead.

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

## Claims must have mechanisms

The central discipline of this site. Every capability claim states the mechanism
that delivers it, in the same breath.

- Not "safe by default" — "`remove-orphans` previews by default, and keys with
  ambiguous evidence are never removed even when you confirm".
- Not "great for agents" — "reports divert to a file on request, so a
  thousand-key result never enters a context window".
- Not "works with monorepos" — "usage is counted per consuming app, so a key
  used in one app is not treated as protecting a key in another".

If you cannot name the mechanism, you do not yet understand the feature well
enough to write the sentence. Read the source or ask.

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

- [ ] Opens by telling the reader what they will be able to do
- [ ] No banned words; no unbacked adjectives
- [ ] Every claim names its mechanism
- [ ] Vocabulary matches the table above, and "layer" is defined if leaned on
- [ ] Package names are scoped
- [ ] Every command, flag and field verified against source
- [ ] Code blocks are labelled, copy-pasteable and complete
- [ ] Links are relative; nothing points at a README that is about to shrink
- [ ] Reference material is linked, not restated
- [ ] Limits and failure modes stated, not omitted
- [ ] Read once end to end — does it sound like the rest of the site?
