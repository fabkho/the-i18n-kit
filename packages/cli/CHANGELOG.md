# Changelog

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
