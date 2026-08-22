#!/usr/bin/env bash
# Pack-and-install smoke test for the php-parser optional peer (#403).
#
# A workspace symlink cannot catch the failure this exists for: the packed CLI
# in a real project, where the parser either is or is not installed. Asserts
# both sides — absent peer warns and falls back to patterns (visibly, via
# declinedFiles), present peer parses.
#
# Usage: scripts/php-peer-smoke.sh   (needs network for npm install)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "── packing the CLI"
(cd "$root" && pnpm --filter the-i18n-cli build >/dev/null)
tarball="$(cd "$root/packages/cli" && npm pack --pack-destination "$work" 2>/dev/null | tail -1)"

echo "── installing into a scratch project (no php-parser)"
cd "$work"
npm init -y >/dev/null 2>&1
npm install "./$tarball" >/dev/null 2>&1
printf '<?php echo __("smoke.from.php");' > probe.php

run() {
  node --input-type=module -e "
    const { scanSourceFiles, createPhpFrontend, createPatternsFrontend, LARAVEL_PATTERNS } = await import('$work/node_modules/the-i18n-cli/dist/index.js')
    const r = await scanSourceFiles('$work', undefined, LARAVEL_PATTERNS, [createPhpFrontend(), createPatternsFrontend(LARAVEL_PATTERNS)])
    console.log(JSON.stringify({ declined: r.declinedFiles, keys: [...r.uniqueKeys] }))
  "
}

out="$(run 2>stderr.txt)"
grep -q "php-parser is not installed" stderr.txt && { echo "FAIL: warned despite available parser"; exit 1; }
echo "$out" | grep -q '"declined":\[\]' || { echo "FAIL: declined despite available parser: $out"; exit 1; }
echo "$out" | grep -q 'smoke.from.php' || { echo "FAIL: parser path did not read the file: $out"; exit 1; }
echo "   packed install: parsed via the frontend, no warning ✓"

# The absent-peer scenario is not reachable today: php-array-reader (a hard
# dependency, PHP locale IO) statically imports php-parser, so the parser is
# in every install transitively and deleting it breaks the CLI's own import.
# #406 makes that IO import lazy and the dependency optional — extend this
# script with the absent case then; the loader's decline-and-warn path is
# covered by unit tests meanwhile.
echo "   absent-peer case deferred to #406 (php-array-reader ships php-parser transitively)"

echo "php-peer-smoke: PASS"
