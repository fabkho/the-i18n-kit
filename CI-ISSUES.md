# the-i18n-kit — issues found while reviving anny-ui MR !1800 (2026-07-22)

Found while analyzing the CI auto-translate pipeline. Ordered by severity.

## Blocking the anny-ui pipeline

### 1. `gitlab-ci.yml` `.i18n-cleanup` calls a command that doesn't exist
`npx the-i18n-cli orphans --layer … --json` → CLI errors `Unknown command orphans`.
The real command is `remove-orphans` (dry-run by default, which is what we want here).
The jq paths are also wrong for the actual output shape:
- `.summary.totalOrphans` → actual field is `.summary.orphanCount`
- `.orphanKeys[]` assumes an array → actual `orphanKeys` is an **object keyed by layer**
  (`.orphanKeys | to_entries[] | .value[]`).
This is exactly why the last `i18n-cleanup` job in anny-ui pipeline 2611643941 failed.

### 2. `after_script` push uses `CI_JOB_TOKEN`, which cannot push code
`git push https://gitlab-ci-token:${CI_JOB_TOKEN}@…` always 403s on gitlab.com
("You are not allowed to push code to this project"). The template needs a
dedicated variable (e.g. `I18N_PUSH_TOKEN`, a project access token with
`write_repository`) and should fail loudly when it's absent instead of relying
on the job token.

### 3. Push/commit lives in `after_script`, so failures are invisible
`after_script` exit codes only produce a WARNING — the anny-ui job showed
**green** while the push 403'd. The commit+push should move into `script`
(keep `allow_failure: true` during trial) so a failed push fails the job.

### 4. MR comment auth is wrong → comments silently never posted
Both jobs post notes with `--header "PRIVATE-TOKEN: ${CI_JOB_TOKEN}"`.
A job token is not a PRIVATE-TOKEN, and the notes API isn't in the job-token
allowlist anyway. Combined with `curl --silent` (no `--fail`), every MR comment
has silently 401'd. Use the same push/API token, and add `--fail` so errors surface.

## Non-blocking / hygiene

### 5. `npm install -g the-i18n-cli@latest` is unpinned
Non-reproducible CI. Add an `I18N_CLI_VERSION` variable (default `latest` is fine,
but consumers should be able to pin). anny-ui already works around this by
overriding `before_script` and using the lockfile devDependency.

### 6. `action.yml` (GitHub action) drifted from the GitLab template fixes
Still greps `.translated // .totalTranslated` — the actual field is
`summary.totalTranslated`. (Its `--json` flag is harmless but redundant:
output is auto-JSON when stdout is not a TTY.)

### 7. No exit-code gate for findings
`missing`, `translate`, `remove-orphans` always exit 0 when they find things;
CI can only gate by parsing JSON. A `--fail-on-missing` / `--fail-on-orphans`
flag would make pipeline gating trivial.

### 8. Stale root `CHANGELOG.md`
Top entry is `2.3.0` under the old repo name; per-package changelogs are the
real ones. Delete or replace the root one to avoid confusion.

### 9. Consumer-side drift in anny-ui (fix in MR !1800, not the kit)
- `package.json` script `i18n:translate` passes `--concurrency 4` — flag doesn't
  exist (citty silently ignores it) — and uses `--ref en-GB` while CI uses
  `I18N_SOURCE_LOCALE: de-DE`. Align both.
- Leftover test artifacts: `common.test.ciTranslate` key (de-DE + en-GB),
  `_ciTestKey` in `RevenueByProductWidget.vue`, plus unrelated formatting churn
  in dashboard-next files.
