# Changelog

## [6.1.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-6.0.0...the-i18n-mcp-6.1.0) (2026-08-09)


### Features

* **cli:** protectedLocales — human-maintained locales excluded from auto-translation ([#226](https://github.com/fabkho/the-i18n-kit/issues/226)) ([8a9152e](https://github.com/fabkho/the-i18n-kit/commit/8a9152e8b71c911eaae842c563e2672126fa7e47)), closes [#211](https://github.com/fabkho/the-i18n-kit/issues/211)

## [6.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-5.0.0...the-i18n-mcp-6.0.0) (2026-08-09)


### ⚠ BREAKING CHANGES

* **mcp:** MCP sampling support is removed. Hosts that offered sampling no longer get translation through it — configure provider mode via I18N_PROVIDER, I18N_MODEL, and the provider API key env on the server process, or use agent mode (fallbackContexts + write_translations).

### Features

* **mcp:** env-configured provider mode, MCP sampling removed ([#222](https://github.com/fabkho/the-i18n-kit/issues/222)) ([9bb74d2](https://github.com/fabkho/the-i18n-kit/commit/9bb74d2b3202e90a76b8c6ad4bd83a16a11cfbf2))

## [5.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-4.0.0...the-i18n-mcp-5.0.0) (2026-08-09)


### ⚠ BREAKING CHANGES

* **cli:** translate_missing and translate_key result shapes changed as described. All consumers (CLI output, MCP tools) updated.

### Features

* **cli:** honest translate result contract — mode, failed/skipped reasons, wouldTranslate ([#220](https://github.com/fabkho/the-i18n-kit/issues/220)) ([9d393bb](https://github.com/fabkho/the-i18n-kit/commit/9d393bb025ddfbf4481ac6f5df716366dc550a3e))

## [4.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.5.1...the-i18n-mcp-4.0.0) (2026-08-09)


### ⚠ BREAKING CHANGES

* **cli:** programmatic API renames — createSamplingFn is now createTranslateFn; translate operations take translateFn instead of samplingFn; Sampling* types are Translate* types. CLI commands and MCP tool surfaces are unaffected.

### Features

* **mcp:** align with MCP 2026-07-28 direction — SDK 1.30, stateless resources ([#217](https://github.com/fabkho/the-i18n-kit/issues/217)) ([fcfa34c](https://github.com/fabkho/the-i18n-kit/commit/fcfa34c8040f16093df9fab501139513bfd67def))


### Code Refactoring

* **cli:** rename translate seam SamplingFn → TranslateFn, drop model preferences ([#216](https://github.com/fabkho/the-i18n-kit/issues/216)) ([3355298](https://github.com/fabkho/the-i18n-kit/commit/3355298da6065192e7bcb68ef96ec9a648e41c74))

## [3.5.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.5.0...the-i18n-mcp-3.5.1) (2026-06-16)


### Bug Fixes

* **mcp:** bump to republish with CLI 1.5.0 dependency ([#185](https://github.com/fabkho/the-i18n-kit/issues/185)) ([00b519d](https://github.com/fabkho/the-i18n-kit/commit/00b519dd55ccd019a8c234014f1f7c2b32c75e1f))

## [3.5.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.4.0...the-i18n-mcp-3.5.0) (2026-06-15)


### Features

* replace node:path with pathe, add exports field to MCP package ([#173](https://github.com/fabkho/the-i18n-kit/issues/173)) ([46e9ac9](https://github.com/fabkho/the-i18n-kit/commit/46e9ac9607b2e7bd68e8df395c09fe23c41d159d))

## [3.4.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.3.1...the-i18n-mcp-3.4.0) (2026-06-15)


### Features

* add list_namespaces MCP tool ([#153](https://github.com/fabkho/the-i18n-kit/issues/153)) ([#163](https://github.com/fabkho/the-i18n-kit/issues/163)) ([474b021](https://github.com/fabkho/the-i18n-kit/commit/474b021e0aa50cb5c05ef484fa9451738aaa3180))
* search all layers, compact outputs for get_translations and translate_missing ([#162](https://github.com/fabkho/the-i18n-kit/issues/162)) ([5c8cfaf](https://github.com/fabkho/the-i18n-kit/commit/5c8cfafc36a8bb30be01538da94f7c0cbe4fea6d))


### Bug Fixes

* remove repository directory field to fix Glama repo URL resolution ([0807be4](https://github.com/fabkho/the-i18n-kit/commit/0807be407244fa31747dc9b9e50839cdec32dcfb))

## [3.3.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.3.0...the-i18n-mcp-3.3.1) (2026-06-11)


### Performance Improvements

* add concurrent locale translation + LLM provider abstraction ([#141](https://github.com/fabkho/the-i18n-kit/issues/141)) ([7e09ec2](https://github.com/fabkho/the-i18n-kit/commit/7e09ec25ac18481391b6847675222808c4cbaaa1))
* parallel translation + LLM providers + API consolidation + fallow CI ([#144](https://github.com/fabkho/the-i18n-kit/issues/144)) ([caf7349](https://github.com/fabkho/the-i18n-kit/commit/caf7349a81ac7a066dbf6c25909c92c6bcaa32b4))

## [3.3.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.2.0...the-i18n-mcp-3.3.0) (2026-06-02)


### Features

* add source key translation tool ([#137](https://github.com/fabkho/the-i18n-kit/issues/137)) ([b3ceae7](https://github.com/fabkho/the-i18n-kit/commit/b3ceae715e171c329cf18f0b88299c80419b1d00))

## [3.2.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.1.0...the-i18n-mcp-3.2.0) (2026-05-09)


### Features

* **mcp:** improve project config section in prompts ([1048be5](https://github.com/fabkho/the-i18n-kit/commit/1048be5d2dd732fc504bf9b7df58a95ceec80d5a))


### Bug Fixes

* **mcp:** clearer schema hint for add_translations, batching hint for translate_missing ([#131](https://github.com/fabkho/the-i18n-kit/issues/131)) ([760cff7](https://github.com/fabkho/the-i18n-kit/commit/760cff754bcc1e3168ad1b0bb7f6c8c5507e5fdd))

## [3.1.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.0.1...the-i18n-mcp-3.1.0) (2026-05-09)


### Features

* add outputFile param to large-output tools ([#127](https://github.com/fabkho/the-i18n-kit/issues/127)) ([763494e](https://github.com/fabkho/the-i18n-kit/commit/763494ee3955bf05692f59c65633754dc3d95f67))

## [3.0.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-3.0.0...the-i18n-mcp-3.0.1) (2026-04-28)


### Bug Fixes

* include package READMEs in npm publish ([53763b9](https://github.com/fabkho/the-i18n-kit/commit/53763b99650e849df3ffe4584f8162a51538dd06))

## [3.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-mcp-2.3.0...the-i18n-mcp-3.0.0) (2026-04-28)


### ⚠ BREAKING CHANGES

* restructured into pnpm workspace monorepo.

### Features

* add CLI interface, make project CLI-first + MCP ([#120](https://github.com/fabkho/the-i18n-kit/issues/120)) ([874abf4](https://github.com/fabkho/the-i18n-kit/commit/874abf41ed8caf479849934424bcb6e59b177703))
