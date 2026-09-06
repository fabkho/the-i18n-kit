#!/usr/bin/env bash
# Pack-and-install smoke test for the php-parser optional peer (#403).
#
# A workspace symlink cannot catch the failure this exists for: the packed CLI
# in a real project, where the parser either is or is not installed. Asserts
# both sides — absent peer warns and falls back to patterns (visibly, via
# declinedFiles), present peer parses.
#
# Usage: packages/cli/scripts/php-peer-smoke.sh   (needs network for npm install)
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
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

# ── the JS-only world (#406): no PHP anywhere in the tree
if npm ls php-parser >/dev/null 2>&1 || npm ls php-array-reader >/dev/null 2>&1; then
  echo "FAIL: a JS-only install carries PHP packages"; npm ls php-parser php-array-reader; exit 1
fi
out="$(run 2>stderr.txt)"
grep -q "php-parser is not installed" stderr.txt || { echo "FAIL: missing-peer warning not printed"; cat stderr.txt; exit 1; }
echo "$out" | grep -q '"declined":\["probe.php"\]' || { echo "FAIL: absent peer did not decline visibly: $out"; exit 1; }
echo "$out" | grep -q 'smoke.from.php' || { echo "FAIL: pattern fallback did not read the file: $out"; exit 1; }
echo "   JS-only install: zero PHP packages, warned, declined, patterns read the file ✓"

echo "── installing the Laravel peers"
npm install php-parser php-array-reader >/dev/null 2>&1
out="$(run 2>stderr.txt)"
grep -q "php-parser is not installed" stderr.txt && { echo "FAIL: warned despite installed peer"; exit 1; }
echo "$out" | grep -q '"declined":\[\]' || { echo "FAIL: declined despite installed peer: $out"; exit 1; }
echo "   Laravel install: parsed via the frontend, no warning ✓"

echo "php-peer-smoke: PASS"
