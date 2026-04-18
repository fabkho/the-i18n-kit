# MCP Testing Guide — the-i18n-mcp via JSON-RPC

Test the MCP server directly from the terminal without VS Code by piping JSON-RPC messages to the built server via stdio.

## Prerequisites

- Built server at `dist/index.js` (run `pnpm build` first)
- Target project with `.i18n-mcp.json` config (e.g., `~/code/anny/anny-ui`)

## Session Setup

Every test session requires 3 messages in sequence:

1. `initialize` — handshake
2. `notifications/initialized` — confirm ready
3. `tools/call` — the actual tool invocation

Always call `detect_i18n_config` before any other tool in a session.

## Base Command Pattern

```bash
printf '<line1>\n<line2>\n<line3>\n' | timeout <seconds> node dist/index.js 2>/dev/null | grep '"id":<N>'
```

- `2>/dev/null` suppresses server debug logs on stderr
- `grep '"id":<N>'` extracts just the response for call N
- `timeout` prevents hanging if the server doesn't exit

## Common Test Sequences

### 1. detect_i18n_config

Validates config loading, layer discovery, locale detection, and `.i18n-mcp.json` parsing.

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_i18n_config","arguments":{"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n' | timeout 30 node dist/index.js 2>/dev/null | grep '"id":2'
```

**Check:**
- `framework` = `"nuxt"`
- `localeDirs` has entries for root, app-admin, app-shop, app-designer, app-select, app-panels, app-outlook
- `app-outlook` has `aliasOf: "app-shop"`
- `projectConfig.orphanScan` shows `includeParentLayer: true` for app layers
- No `ConfigError` thrown (means `.i18n-mcp.json` validation passed)

### 2. find_orphan_keys (single layer)

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_i18n_config","arguments":{"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_orphan_keys","arguments":{"layer":"app-shop","locale":"de","projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n' | timeout 120 node dist/index.js 2>/dev/null | grep '"id":3'
```

**Check:**
- `summary.dirsScanned` has 2 entries when `includeParentLayer: true` (own dir + root)
- `summary.dirsScanned` has 1 entry when `includeParentLayer: false` or not set
- `summary.dynamicMatchedCount` > 0 (dynamic key matching working)
- `orphanKeys` does NOT contain keys with static `t()` calls in scanned dirs
- `dynamicKeys` lists template literal expressions found

### 3. find_orphan_keys (all layers)

Omit the `layer` param to scan all layers at once:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_i18n_config","arguments":{"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_orphan_keys","arguments":{"locale":"de","projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n' | timeout 180 node dist/index.js 2>/dev/null | grep '"id":3'
```

### 4. scan_code_usage (verify specific key)

Check where a specific key is referenced:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_i18n_config","arguments":{"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"scan_code_usage","arguments":{"keys":["components.registerHint.title","components.registerHint.testResultClaim"],"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n' | timeout 60 node dist/index.js 2>/dev/null | grep '"id":3'
```

**Check:**
- Used keys show file paths and line numbers
- Unused keys show no usages
- Cross-reference with `find_orphan_keys` results

### 5. cleanup_unused_translations (dry run)

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_i18n_config","arguments":{"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cleanup_unused_translations","arguments":{"layer":"app-shop","locale":"de","dryRun":true,"projectDir":"/Users/fabiankirchhoff/code/anny/anny-ui"}}}\n' | timeout 120 node dist/index.js 2>/dev/null | grep '"id":3'
```

**Check:**
- `dryRun: true` — no files modified
- Orphan list matches `find_orphan_keys` output
- Preview shows which keys would be removed from which files

## Parsing Large Responses

Pipe through `node -e` to extract specific fields:

```bash
# Extract just orphan keys for a layer
... | grep '"id":3' | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const r=JSON.parse(d); const t=JSON.parse(r.result.content[0].text);
    console.log('Orphan count:', t.summary.orphanCount);
    console.log('Dirs scanned:', t.summary.dirsScanned);
    console.log('Files scanned:', t.summary.filesScanned);
    console.log('Dynamic matched:', t.summary.dynamicMatchedCount);
  })
"
```

```bash
# Check if a specific key is in the orphan list
... | grep '"id":3' | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const r=JSON.parse(d); const t=JSON.parse(r.result.content[0].text);
    const keys = Object.values(t.orphanKeys).flat();
    const check = ['pages.testResult.title','pages.testResult.acceptCheckbox'];
    check.forEach(k => console.log(k + ':', keys.includes(k) ? 'ORPHAN' : 'NOT ORPHAN'));
  })
"
```

```bash
# Count orphans per layer (when scanning all layers)
... | grep '"id":3' | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const r=JSON.parse(d); const t=JSON.parse(r.result.content[0].text);
    for (const [layer, keys] of Object.entries(t.orphanKeys)) {
      console.log(layer + ': ' + keys.length + ' orphans');
    }
  })
"
```

## Verification Checklist

### includeParentLayer

1. Run `find_orphan_keys` for an app layer WITH `includeParentLayer: true` in config
2. Check `dirsScanned` has 2 entries (app dir + project root)
3. Run again after removing `includeParentLayer` from config
4. Check `dirsScanned` has 1 entry (app dir only)
5. Compare orphan counts — without parent layer should have MORE orphans

### Backtick Template Literals (#97)

1. Find a key used via `` t(`some.static.key`) `` (no interpolation) in the codebase
2. Confirm it's NOT in the orphan list
3. Find a key used via `` t(`some.${dynamic}.key`) `` — confirm it appears in `dynamicKeys`

### Bare String Matching

1. Find a key used as a bare string (e.g., `label: 'some.dotted.key'`) without `t()`
2. Confirm it's NOT in the orphan list
3. Use `scan_code_usage` to verify the scanner found it

### Cross-Layer Scoping

1. A key defined in root and used in app-admin code — should NOT be orphan in root layer
2. A key defined in app-admin and used ONLY in app-admin — should NOT be orphan
3. A key defined in app-admin and used ONLY in root code — should NOT be orphan when root has `includeParentLayer: true`... wait, that's the wrong direction. `includeParentLayer` is on the APP layer config, meaning app-admin scans root too. For root layer scanning, root scans everything (project root = all dirs).

### Config Validation

1. Add `"scanDirs": [...]` to orphanScan layer — should throw `ConfigError` with "unknown property"
2. Add `"includeParentLayer": "yes"` (string not boolean) — should throw
3. Empty `"orphanScan": {}` — should work fine
4. Missing `orphanScan` entirely — should work fine (defaults to no ignore patterns, no parent layer)

### Alias Layers

1. `app-outlook` is `aliasOf: "app-shop"` — `find_orphan_keys` for `app-outlook` should return `[LAYER_IS_ALIAS]`
2. Keys in `outlook.*` namespace live in app-shop locale files but are used in app-outlook source code
3. When scanning app-shop, `outlook.*` keys may appear as orphans because app-outlook source isn't in app-shop's scan dirs — this is a known limitation

## Baseline Numbers (anny-ui, 2026-04-18)

| Layer | Total Keys | Orphans | Dynamic Matched | Files Scanned |
|---|---|---|---|---|
| root | 1,775 | 421 | 159 | 2,384 |
| app-admin | 4,586 | 658 | 183 | 2,699 |
| app-shop | 478 | 175 | 60 | 1,657 |
| app-designer | 180 | 9 | 16 | 1,255 |
| app-select | 9 | 1 | 0 | 1,027 |
| app-panels | 4 | 0 | 0 | 1,049 |
| app-outlook | — | — | — | — (alias) |
| **TOTAL** | **7,032** | **1,264** | **418** | — |

Previous pooled approach: ~2,253 orphans. Current per-layer: 1,264 (-44%).
