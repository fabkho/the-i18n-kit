---
seo:
  title: The i18n toolkit for AI agents and large monorepos
  description: Find missing keys, remove dead ones, and rename across every locale
    and layer at once — from your agent, your terminal, or your pipeline.
---

::u-page-hero
#title
The i18n toolkit for AI agents and large monorepos

#description
Find missing keys, remove dead ones, and rename across every locale and layer at
once. One engine behind a CLI, an MCP server, a Nuxt module and two CI
integrations — so your terminal and your agent give the same answers.

#links
  :::u-button
  ---
  color: neutral
  size: xl
  to: /getting-started/agent-setup
  trailing-icon: i-lucide-arrow-right
  ---
  Set up the MCP server
  :::

  :::u-button
  ---
  color: neutral
  size: xl
  to: /getting-started/cold-start
  variant: outline
  ---
  Start from an unconfigured repo
  :::
::

::u-page-section
#title
Built for agents, and for repositories nobody can hold in their head

#features
  :::u-page-feature
  ---
  icon: i-lucide-bot
  to: /introduction/built-for-agents
  ---
  #title
  Agent-native, with receipts

  #description
  Reports divert to disk on request, so a thousand-key result never enters a
  context window. Machine output cannot be corrupted by a library logging to
  stdout. Failures carry a reason from a closed set, so an agent branches on a
  value instead of pattern-matching English.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-network
  to: /monorepos/layers
  ---
  #title
  Monorepo-native

  #description
  Usage is counted per consuming app, so a key used in one app is never treated
  as protecting a key in another. Keys with ambiguous evidence go in their own
  bucket and are never deleted, which is what makes an automated cleanup safe to
  review.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-git-pull-request
  to: /reference/cli/check
  ---
  #title
  CI-native

  #description
  Findings gate a pipeline through exit codes, so a run that translated nothing
  cannot go green. A GitHub Action and a GitLab template ship with the kit,
  provider-agnostic, with your own API key.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-layers
  to: /frameworks/detection
  ---
  #title
  Reads your project rather than asking you to restate it

  #description
  Nuxt, Laravel, Vue, React and Next, or anything with JSON or PHP locale files.
  Where a project already declares its locales — a next-intl routing file, a Vite
  plugin, a Nuxt config — the kit executes that file and reads it.
  :::
::

::u-page-section
#title
Start where you are

#features
  :::u-page-feature
  ---
  icon: i-lucide-terminal
  to: /reference/cli
  ---
  #title
  From the terminal

  #description
  Install `@the-i18n-kit/cli`, then run `the-i18n-cli status` for coverage per
  locale and per layer. Every command is documented from its own definition, so
  the reference cannot describe a flag that no longer exists.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-settings-2
  to: /configuration/where-config-lives
  ---
  #title
  From your config

  #description
  Declare a glossary, tone notes and protected locales once, typed, with no build
  step — so the policy applies in an unbuilt checkout too, where a build artifact
  would not have reached the tool.
  :::
::
