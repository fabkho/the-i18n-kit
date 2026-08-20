# Changelog

## [4.10.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.10.0...the-i18n-cli-4.10.1) (2026-08-17)


### Bug Fixes

* **ci:** let a tripped gate redden the job without discarding the work ([#373](https://github.com/fabkho/the-i18n-kit/issues/373)) ([9b60261](https://github.com/fabkho/the-i18n-kit/commit/9b602616a9625b84ddd19df59a3db4f25354954a))
* **config:** check every declaration site, and alias the name the docs use ([#375](https://github.com/fabkho/the-i18n-kit/issues/375)) ([ab1a268](https://github.com/fabkho/the-i18n-kit/commit/ab1a268a308baa7a7acf5a6354004243432f2a47)), closes [#362](https://github.com/fabkho/the-i18n-kit/issues/362) [#361](https://github.com/fabkho/the-i18n-kit/issues/361)
* **config:** generate the published JSON Schema from the zod schema ([#346](https://github.com/fabkho/the-i18n-kit/issues/346)) ([#368](https://github.com/fabkho/the-i18n-kit/issues/368)) ([9bfcbc5](https://github.com/fabkho/the-i18n-kit/commit/9bfcbc5f788610dac079855ef0ee6f02746ec0a0))

## [4.10.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.9.0...the-i18n-cli-4.10.0) (2026-08-16)


### Features

* tell users on the old package names that the kit has moved ([#338](https://github.com/fabkho/the-i18n-kit/issues/338)) ([18f146d](https://github.com/fabkho/the-i18n-kit/commit/18f146dfb3fea19102fb97b4ee745b41850aa7aa))

## [4.9.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.8.1...the-i18n-cli-4.9.0) (2026-08-16)


### Features

* **release:** publish the packages under the [@the-i18n-kit](https://github.com/the-i18n-kit) scope too ([#336](https://github.com/fabkho/the-i18n-kit/issues/336)) ([f56f1c1](https://github.com/fabkho/the-i18n-kit/commit/f56f1c1b6097b4b99e24e9fd2c9542106a5a6da2)), closes [#315](https://github.com/fabkho/the-i18n-kit/issues/315)

## [4.8.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.8.0...the-i18n-cli-4.8.1) (2026-08-16)


### Bug Fixes

* **generic:** support flat PHP locale files end to end ([#331](https://github.com/fabkho/the-i18n-kit/issues/331)) ([1533453](https://github.com/fabkho/the-i18n-kit/commit/15334532d97f3e28538339baf3b136707f34e3b1)), closes [#308](https://github.com/fabkho/the-i18n-kit/issues/308)
* **scanner:** scan files in a stable order ([#334](https://github.com/fabkho/the-i18n-kit/issues/334)) ([bcc46b0](https://github.com/fabkho/the-i18n-kit/commit/bcc46b0c47d82526314e3d84383c767153071c20))
* **scanner:** stop offering a used single-segment key for deletion ([#330](https://github.com/fabkho/the-i18n-kit/issues/330)) ([794104b](https://github.com/fabkho/the-i18n-kit/commit/794104baec93ee23a9a2152fb67fad0012358593)), closes [#298](https://github.com/fabkho/the-i18n-kit/issues/298)

## [4.8.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.7.0...the-i18n-cli-4.8.0) (2026-08-16)


### Features

* **cli:** typed config, and read the framework's own config instead of guessing ([#328](https://github.com/fabkho/the-i18n-kit/issues/328)) ([83c22b8](https://github.com/fabkho/the-i18n-kit/commit/83c22b8e3c3b44e1fd39270e81c38225f1d44d5a)), closes [#324](https://github.com/fabkho/the-i18n-kit/issues/324)
* **nuxt:** declare the kit's config in nuxt.config.ts, typed ([#322](https://github.com/fabkho/the-i18n-kit/issues/322)) ([25175a5](https://github.com/fabkho/the-i18n-kit/commit/25175a580fe2e805bf861e24c0fa6c531283e927))


### Bug Fixes

* **cli:** salvage a translate response that ends mid-object ([#326](https://github.com/fabkho/the-i18n-kit/issues/326)) ([8edfc23](https://github.com/fabkho/the-i18n-kit/commit/8edfc23183b7601704f0a20fa28eef0e7058a4d5)), closes [#325](https://github.com/fabkho/the-i18n-kit/issues/325)

## [4.7.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.6.0...the-i18n-cli-4.7.0) (2026-08-14)


### Features

* **nuxt:** publish the layer graph and locale table from inside the build ([#319](https://github.com/fabkho/the-i18n-kit/issues/319)) ([4a64746](https://github.com/fabkho/the-i18n-kit/commit/4a64746fb27675308e4faaed559fde5a64ef1a70))

## [4.6.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.5.0...the-i18n-cli-4.6.0) (2026-08-14)


### Features

* **cli:** gate translate on partial failures, and stop them being silent ([#317](https://github.com/fabkho/the-i18n-kit/issues/317)) ([7525579](https://github.com/fabkho/the-i18n-kit/commit/752557925a1630af4f6a6eb41e31e64f7ff7ce72)), closes [#316](https://github.com/fabkho/the-i18n-kit/issues/316)

## [4.5.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.4.0...the-i18n-cli-4.5.0) (2026-08-14)


### Features

* **cli:** status — coverage per locale and per layer, with a --fail-under gate ([#311](https://github.com/fabkho/the-i18n-kit/issues/311)) ([8db7c96](https://github.com/fabkho/the-i18n-kit/commit/8db7c96128d79ce6f120fc9745b01e4130e4168d)), closes [#253](https://github.com/fabkho/the-i18n-kit/issues/253)


### Bug Fixes

* **cli:** register scan so it can actually be invoked ([#310](https://github.com/fabkho/the-i18n-kit/issues/310)) ([9db0f6e](https://github.com/fabkho/the-i18n-kit/commit/9db0f6e0e70281c61e004974d4af6cca601017f1)), closes [#307](https://github.com/fabkho/the-i18n-kit/issues/307)

## [4.4.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.3.0...the-i18n-cli-4.4.0) (2026-08-13)


### Features

* **cli:** init — generate a schema-valid .i18n-mcp.json from detection ([#306](https://github.com/fabkho/the-i18n-kit/issues/306)) ([ac92dbd](https://github.com/fabkho/the-i18n-kit/commit/ac92dbdce1ff429c995383324f38ae138fa12392))


### Bug Fixes

* **cli:** report unresolved and ambiguous locale refs instead of dropping them ([#302](https://github.com/fabkho/the-i18n-kit/issues/302)) ([a257a5f](https://github.com/fabkho/the-i18n-kit/commit/a257a5f9237805f4003efff0a1f84d1868e06a18))

## [4.3.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.2.0...the-i18n-cli-4.3.0) (2026-08-11)


### Features

* **cli:** provider baseUrl via flag, env and project config ([#282](https://github.com/fabkho/the-i18n-kit/issues/282)) ([af5cc9a](https://github.com/fabkho/the-i18n-kit/commit/af5cc9a9d0f9299e630f1ca0b379d2e8576fb672))
* **cli:** resolveExitCode + --fail-on-missing / --fail-on-orphans CI gates ([#297](https://github.com/fabkho/the-i18n-kit/issues/297)) ([5324b59](https://github.com/fabkho/the-i18n-kit/commit/5324b59cd1f7c1791ef548506054e78d4d8942cb)), closes [#248](https://github.com/fabkho/the-i18n-kit/issues/248)

## [4.2.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.1.1...the-i18n-cli-4.2.0) (2026-08-11)


### Features

* **ci:** trigger a follow-up MR pipeline after the translate auto-commit push ([#293](https://github.com/fabkho/the-i18n-kit/issues/293)) ([38f4e0b](https://github.com/fabkho/the-i18n-kit/commit/38f4e0b2bd837424d7c95099de3d7c3661ee39e2)), closes [#283](https://github.com/fabkho/the-i18n-kit/issues/283)
* **cli:** make translate --layer optional — all-layers mode with aggregated totals ([#292](https://github.com/fabkho/the-i18n-kit/issues/292)) ([0126561](https://github.com/fabkho/the-i18n-kit/commit/012656152dbf4a09252234059832150d57b44810)), closes [#290](https://github.com/fabkho/the-i18n-kit/issues/290)


### Bug Fixes

* **cli:** gate bare-candidate shapes by pattern-set language ([#291](https://github.com/fabkho/the-i18n-kit/issues/291)) ([e71d55d](https://github.com/fabkho/the-i18n-kit/commit/e71d55d495ecbe8a2a4429920f66b78b9ed30e02)), closes [#288](https://github.com/fabkho/the-i18n-kit/issues/288)
* **cli:** suppress variable-prefix dynamic keys in orphan scan ([#285](https://github.com/fabkho/the-i18n-kit/issues/285)) ([af54732](https://github.com/fabkho/the-i18n-kit/commit/af54732129ebc3dcf1d30cdf72b43e1dc9905fd6))

## [4.1.1](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.1.0...the-i18n-cli-4.1.1) (2026-08-10)


### Bug Fixes

* **cli:** deterministic orphan reports and orphanScan layer-key validation ([#268](https://github.com/fabkho/the-i18n-kit/issues/268)) ([ccec19a](https://github.com/fabkho/the-i18n-kit/commit/ccec19a5d34ef8bf8c95f93c6da9b644dc65a953))
* **cli:** never classify indirectly-consumed or Laravel-idiom keys as hard findings ([#269](https://github.com/fabkho/the-i18n-kit/issues/269)) ([4a7f1a2](https://github.com/fabkho/the-i18n-kit/commit/4a7f1a2407909594f01f516fdd81c0fa67aaed46)), closes [#262](https://github.com/fabkho/the-i18n-kit/issues/262) [#267](https://github.com/fabkho/the-i18n-kit/issues/267)
* **cli:** resolve relative --output-file against project dir, emit JSON error object on failure ([#280](https://github.com/fabkho/the-i18n-kit/issues/280)) ([181da7e](https://github.com/fabkho/the-i18n-kit/commit/181da7e28bad659a70e4d64b9097262fa4e92af7))
* **cli:** restrict bare-template collector to key-shaped candidates ([#281](https://github.com/fabkho/the-i18n-kit/issues/281)) ([86b1a48](https://github.com/fabkho/the-i18n-kit/commit/86b1a48f16b6e70490f1765d3c94c45b4e997560)), closes [#275](https://github.com/fabkho/the-i18n-kit/issues/275)

## [4.1.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-4.0.0...the-i18n-cli-4.1.0) (2026-08-10)


### Features

* **cli:** GitLab Code Quality output for check and remove-orphans ([#271](https://github.com/fabkho/the-i18n-kit/issues/271)) ([09a0e99](https://github.com/fabkho/the-i18n-kit/commit/09a0e99d7551b6722f9d12de931de28b8535fdd0)), closes [#270](https://github.com/fabkho/the-i18n-kit/issues/270)

## [4.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-3.2.0...the-i18n-cli-4.0.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* **cli:** locale write output formatting changed. Existing files keep their detected indentation, trailing newline, PHP quote style and existing key order instead of being normalized to tab indentation and fully re-sorted keys; new keys are inserted alphabetically among their siblings. Namespace files are now only deleted when the mutation explicitly removed the namespace, with a warning per deleted file.

### Features

* **cli:** check — used-but-undefined key detection with CI exit gating ([#245](https://github.com/fabkho/the-i18n-kit/issues/245)) ([6c4b9bf](https://github.com/fabkho/the-i18n-kit/commit/6c4b9bffec124529b415bcbfa1be21af00f715bf))
* **cli:** find_duplicate_keys — cross-layer key collisions with divergence detection ([#243](https://github.com/fabkho/the-i18n-kit/issues/243)) ([cf2343d](https://github.com/fabkho/the-i18n-kit/commit/cf2343dcc6cd17dcf2400cb234e542c464ab54d7))
* **cli:** layer graph — canonical layers, ownership, app-consumption edges ([#240](https://github.com/fabkho/the-i18n-kit/issues/240)) ([a2c2046](https://github.com/fabkho/the-i18n-kit/commit/a2c204616e7715dc68791ad22f9c931b3ec200f4)), closes [#234](https://github.com/fabkho/the-i18n-kit/issues/234)
* **cli:** layer-scope-aware orphan scanning with misplaced-usage detection ([#244](https://github.com/fabkho/the-i18n-kit/issues/244)) ([04cc252](https://github.com/fabkho/the-i18n-kit/commit/04cc2521e323cf9b87e131b0fc39320182a731af))
* **cli:** translate-missing alias for translate ([#230](https://github.com/fabkho/the-i18n-kit/issues/230)) ([3c3ca8b](https://github.com/fabkho/the-i18n-kit/commit/3c3ca8bf63e36818c6e38feeffc82a9037c78f38))


### Bug Fixes

* **cli:** preserve locale file formatting, deliberate deletes, PHP escaping, React flat layouts ([#241](https://github.com/fabkho/the-i18n-kit/issues/241)) ([d1a435b](https://github.com/fabkho/the-i18n-kit/commit/d1a435b4141f24d0b8473ed002f68930d137fe1d)), closes [#194](https://github.com/fabkho/the-i18n-kit/issues/194)
* **cli:** unify locale-dir claim logic, stop dropping dirs behind alias owners ([#238](https://github.com/fabkho/the-i18n-kit/issues/238)) ([7ae3b8f](https://github.com/fabkho/the-i18n-kit/commit/7ae3b8fcbd23ee91c0fe51c9c6882520ee3f1495)), closes [#233](https://github.com/fabkho/the-i18n-kit/issues/233)

## [3.2.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-3.1.0...the-i18n-cli-3.2.0) (2026-08-09)


### Features

* **cli:** protectedLocales — human-maintained locales excluded from auto-translation ([#226](https://github.com/fabkho/the-i18n-kit/issues/226)) ([8a9152e](https://github.com/fabkho/the-i18n-kit/commit/8a9152e8b71c911eaae842c563e2672126fa7e47)), closes [#211](https://github.com/fabkho/the-i18n-kit/issues/211)
* **cli:** provider error classification, truncation detection, CI exit codes ([#225](https://github.com/fabkho/the-i18n-kit/issues/225)) ([b42991d](https://github.com/fabkho/the-i18n-kit/commit/b42991d520fad1004298fa069a3c23918b8b24cd))

## [3.1.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-3.0.0...the-i18n-cli-3.1.0) (2026-08-09)


### Features

* **cli:** per-variant placeholder and plural-count validation ([#223](https://github.com/fabkho/the-i18n-kit/issues/223)) ([bf0b7e0](https://github.com/fabkho/the-i18n-kit/commit/bf0b7e0a36d0884455151c963256282cf8d07eca))

## [3.0.0](https://github.com/fabkho/the-i18n-kit/compare/the-i18n-cli-2.0.0...the-i18n-cli-3.0.0) (2026-08-09)


### ⚠ BREAKING CHANGES

* **cli:** translate_missing and translate_key result shapes changed as described. All consumers (CLI output, MCP tools) updated.

### Features

* **cli:** honest translate result contract — mode, failed/skipped reasons, wouldTranslate ([#220](https://github.com/fabkho/the-i18n-kit/issues/220)) ([9d393bb](https://github.com/fabkho/the-i18n-kit/commit/9d393bb025ddfbf4481ac6f5df716366dc550a3e))

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
