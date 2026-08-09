# Changelog

## [2.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.7...the-i18n-cli-2.0.0) (2026-08-09)


### ⚠ BREAKING CHANGES

* **cli:** programmatic API renames — createSamplingFn is now createTranslateFn; translate operations take translateFn instead of samplingFn; Sampling* types are Translate* types. CLI commands and MCP tool surfaces are unaffected.

### Features

* **mcp:** align with MCP 2026-07-28 direction — SDK 1.30, stateless resources ([#217](https://github.com/fabkho/the-i18n-kit/issues/217)) ([fcfa34c](https://github.com/fabkho/the-i18n-kit/commit/fcfa34c8040f16093df9fab501139513bfd67def))


### Code Refactoring

* **cli:** rename translate seam SamplingFn → TranslateFn, drop model preferences ([#216](https://github.com/fabkho/the-i18n-kit/issues/216)) ([3355298](https://github.com/fabkho/the-i18n-kit/commit/3355298da6065192e7bcb68ef96ec9a648e41c74))

## [1.5.7](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.6...the-i18n-cli-1.5.7) (2026-08-09)


### Bug Fixes

* **cli:** compact translate output keeps fallback contexts and locale metadata ([#213](https://github.com/fabkho/the-i18n-kit/issues/213)) ([8fea19c](https://github.com/fabkho/the-i18n-kit/commit/8fea19c209e505b66c7a8d4476155bca73347932))

## [1.5.6](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.5...the-i18n-cli-1.5.6) (2026-08-09)


### Bug Fixes

* **ci:** cleanup jq backtick escapes + re-land --help stream fix ([#201](https://github.com/fabkho/the-i18n-kit/issues/201)) ([ec98436](https://github.com/fabkho/the-i18n-kit/commit/ec984361dc7ee52c39f0edc28dc30102ac414703))

## [1.5.5](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.4...the-i18n-cli-1.5.5) (2026-08-09)


### Bug Fixes

* **cli:** guard stdout against third-party logs ([#199](https://github.com/fabkho/the-i18n-kit/issues/199)) ([a874e31](https://github.com/fabkho/the-i18n-kit/commit/a874e310518c18b3b1e88641f5b4a54b6b8da8ea))

## [1.5.4](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.3...the-i18n-cli-1.5.4) (2026-08-08)


### Bug Fixes

* CI pipeline repairs — pure-JSON stdout, GitLab template, Action, playground e2e ([#190](https://github.com/fabkho/the-i18n-kit/issues/190)) ([d64a763](https://github.com/fabkho/the-i18n-kit/commit/d64a763b5c85f077d9971460a4f98c76f3258fed))

## [1.5.3](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.2...the-i18n-cli-1.5.3) (2026-06-18)


### Bug Fixes

* **cli:** increase maxOutputTokens budget per key (40→100) ([fe14ec8](https://github.com/fabkho/the-i18n-kit/commit/fe14ec8dc3f80934cf47fd48ddb11f87365b12b4))
* **cli:** use fixed 16384 maxOutputTokens — no reason to scale ([b156c7e](https://github.com/fabkho/the-i18n-kit/commit/b156c7ec2282232e256142f2ad34a7eb8c2bbdf1))

## [1.5.2](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.1...the-i18n-cli-1.5.2) (2026-06-18)


### Bug Fixes

* **cli:** include response preview in 'no valid JSON' error ([73d5878](https://github.com/fabkho/the-i18n-kit/commit/73d58784ab75b42e4ad15a230be7c261a2794e9e))

## [1.5.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.5.0...the-i18n-cli-1.5.1) (2026-06-18)


### Bug Fixes

* **cli:** log actual error message when sampling fails ([f34342a](https://github.com/fabkho/the-i18n-kit/commit/f34342a9882dfbe5b4e6c6c2ea5e22a115dfd2b5))

## [1.5.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.4.0...the-i18n-cli-1.5.0) (2026-06-15)


### Features

* **cli:** expose toErrorMessage in public API ([#183](https://github.com/fabkho/the-i18n-kit/issues/183)) ([5062c10](https://github.com/fabkho/the-i18n-kit/commit/5062c107a88c3f3ae7b61171a1f30cc128e7cb62))

## [1.4.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.3.0...the-i18n-cli-1.4.0) (2026-06-15)


### Features

* add Laravel JSON locale file support ([#164](https://github.com/fabkho/the-i18n-kit/issues/164)) ([914ca0c](https://github.com/fabkho/the-i18n-kit/commit/914ca0c2fb7ae63aa7449fae742d5cdb43b40aca)), closes [#96](https://github.com/fabkho/the-i18n-kit/issues/96)
* add list_namespaces MCP tool ([#153](https://github.com/fabkho/the-i18n-kit/issues/153)) ([#163](https://github.com/fabkho/the-i18n-kit/issues/163)) ([474b021](https://github.com/fabkho/the-i18n-kit/commit/474b021e0aa50cb5c05ef484fa9451738aaa3180))
* add namespaced JSON support — unlocks Next.js, React, Remix ([#145](https://github.com/fabkho/the-i18n-kit/issues/145)) ([#158](https://github.com/fabkho/the-i18n-kit/issues/158)) ([b4f00d9](https://github.com/fabkho/the-i18n-kit/commit/b4f00d99f79aa960b0bf5df752024a1b761820a7))
* add React/Next.js auto-detection adapter ([#149](https://github.com/fabkho/the-i18n-kit/issues/149)) ([#161](https://github.com/fabkho/the-i18n-kit/issues/161)) ([0964473](https://github.com/fabkho/the-i18n-kit/commit/0964473f5bf52aa0740421e77679f9341607af11))
* add Vue standalone adapter for vue-i18n ([#146](https://github.com/fabkho/the-i18n-kit/issues/146)) ([#160](https://github.com/fabkho/the-i18n-kit/issues/160)) ([735e90e](https://github.com/fabkho/the-i18n-kit/commit/735e90e13b8f7daaef2050fc077bd2624b546ba4))
* **cli:** replace custom logger with consola, manual config validation with zod ([#172](https://github.com/fabkho/the-i18n-kit/issues/172)) ([fb6c5d7](https://github.com/fabkho/the-i18n-kit/commit/fb6c5d70cb774f4b7e46a8fe5694da2540980b91))
* search all layers, compact outputs for get_translations and translate_missing ([#162](https://github.com/fabkho/the-i18n-kit/issues/162)) ([5c8cfaf](https://github.com/fabkho/the-i18n-kit/commit/5c8cfafc36a8bb30be01538da94f7c0cbe4fea6d))


### Bug Fixes

* remove repository directory field to fix Glama repo URL resolution ([0807be4](https://github.com/fabkho/the-i18n-kit/commit/0807be407244fa31747dc9b9e50839cdec32dcfb))

## [1.3.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.2.1...the-i18n-cli-1.3.0) (2026-06-12)


### Features

* add Google/Gemini provider support to translate command ([#154](https://github.com/fabkho/the-i18n-kit/issues/154)) ([#156](https://github.com/fabkho/the-i18n-kit/issues/156)) ([e5f044f](https://github.com/fabkho/the-i18n-kit/commit/e5f044f6afd19d32891a08e99c05557c899e1bda))

## [1.2.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.2.0...the-i18n-cli-1.2.1) (2026-06-11)


### Performance Improvements

* add concurrent locale translation + LLM provider abstraction ([#141](https://github.com/fabkho/the-i18n-kit/issues/141)) ([7e09ec2](https://github.com/fabkho/the-i18n-kit/commit/7e09ec25ac18481391b6847675222808c4cbaaa1))
* parallel translation + LLM providers + API consolidation + fallow CI ([#144](https://github.com/fabkho/the-i18n-kit/issues/144)) ([caf7349](https://github.com/fabkho/the-i18n-kit/commit/caf7349a81ac7a066dbf6c25909c92c6bcaa32b4))

## [1.2.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.1.0...the-i18n-cli-1.2.0) (2026-06-02)


### Features

* add source key translation tool ([#137](https://github.com/fabkho/the-i18n-kit/issues/137)) ([b3ceae7](https://github.com/fabkho/the-i18n-kit/commit/b3ceae715e171c329cf18f0b88299c80419b1d00))


### Bug Fixes

* **cli:** honor projectConfig.locales override in all adapters ([#139](https://github.com/fabkho/the-i18n-kit/issues/139)) ([5ea0da0](https://github.com/fabkho/the-i18n-kit/commit/5ea0da0a9e462a14ec1cd0e5275f791041c95d9c))

## [1.1.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.0.1...the-i18n-cli-1.1.0) (2026-05-09)


### Features

* add outputFile param to large-output tools ([#127](https://github.com/fabkho/the-i18n-kit/issues/127)) ([763494e](https://github.com/fabkho/the-i18n-kit/commit/763494ee3955bf05692f59c65633754dc3d95f67))


### Bug Fixes

* simplify orphan scan — root-first scan, fix false positives ([#126](https://github.com/fabkho/the-i18n-kit/issues/126)) ([94cf963](https://github.com/fabkho/the-i18n-kit/commit/94cf963e93ea530247ea39aac4c757a889180317))

## [1.0.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-1.0.0...the-i18n-cli-1.0.1) (2026-04-28)


### Bug Fixes

* include package READMEs in npm publish ([53763b9](https://github.com/fabkho/the-i18n-kit/commit/53763b99650e849df3ffe4584f8162a51538dd06))

## 1.0.0 (2026-04-28)


### ⚠ BREAKING CHANGES

* restructured into pnpm workspace monorepo.

### Features

* add CLI interface, make project CLI-first + MCP ([#120](https://github.com/fabkho/the-i18n-kit/issues/120)) ([874abf4](https://github.com/fabkho/the-i18n-kit/commit/874abf41ed8caf479849934424bcb6e59b177703))
