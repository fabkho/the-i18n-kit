#!/usr/bin/env node
/**
 * Compare the scanner's frontends over a real project (#332).
 *
 * The architecture is not in question; the migration is, because this is the
 * component that deletes locale files. So each frontend is adopted only after
 * this shows it is at least as conservative as what it replaces, on a project
 * rather than a fixture.
 *
 * Reports both directions. A key the new frontend finds and the old one misses
 * is an improvement; a key the old one finds and the new one misses is a key
 * that would be offered for deletion, and is the reason this exists.
 *
 * Usage: node scripts/scanner-diff.mjs <projectDir>
 */
import { performance } from 'node:perf_hooks'

const args = process.argv.slice(2)
const laravel = args.includes('--laravel')
const [projectDir] = args.filter(a => a !== '--laravel')

if (!projectDir) {
  console.error('Usage: node scripts/scanner-diff.mjs <projectDir> [--laravel]')
  process.exit(1)
}

const {
  scanSourceFiles, createOxcFrontend, createPatternsFrontend, createPhpFrontend, createBladeFrontend,
  VUE_NUXT_PATTERNS, LARAVEL_PATTERNS,
} = await import('../packages/cli/dist/index.js').catch(() => {
  console.error('Build the CLI first: pnpm --filter the-i18n-cli build')
  process.exit(1)
})

const PATTERNS = laravel ? LARAVEL_PATTERNS : VUE_NUXT_PATTERNS
const syntaxFrontends = laravel ? [createPhpFrontend(), createBladeFrontend()] : [createOxcFrontend()]
const FRONTENDS = {
  regex: [createPatternsFrontend(PATTERNS)],
  ast: [...syntaxFrontends, createPatternsFrontend(PATTERNS)],
}

async function run(label, scanner) {
  const started = performance.now()
  const result = await scanSourceFiles(projectDir, undefined, PATTERNS, FRONTENDS[scanner])
  const elapsed = performance.now() - started

  console.log(
    `${label.padEnd(8)} ${String(result.filesScanned).padStart(5)} files  `
    + `${String(result.uniqueKeys.size).padStart(5)} keys  `
    + `${String(result.dynamicKeys.length).padStart(4)} dynamic  `
    + `${String(result.bareStringCandidates.size).padStart(5)} candidates  `
    + `${(elapsed / 1000).toFixed(2)}s`,
  )
  return result
}

const regex = await run('regex', 'regex')
const ast = await run('ast', 'ast')

const onlyRegex = [...regex.uniqueKeys].filter(k => !ast.uniqueKeys.has(k)).sort()
const onlyAst = [...ast.uniqueKeys].filter(k => !regex.uniqueKeys.has(k)).sort()

// The frontends write dynamic expressions differently — the regex keeps the
// original interpolation text, the AST normalises slots to ${_} — so compare
// them with the slots erased, the way the orphan planner treats them.
const normalise = expr => expr.replace(/\$\{[^}]*\}/g, '${_}')
const astDynamic = new Set(ast.dynamicKeys.map(dk => normalise(dk.expression)))
const regexDynamic = new Set(regex.dynamicKeys.map(dk => normalise(dk.expression)))

// A key that left uniqueKeys can still be protected: the bare-candidate net
// and the dynamic-key regexes also veto orphans. Only a key covered by none
// of them changes what remove-orphans would do.
const astDynamicMatchers = [...astDynamic].map((expr) => {
  const inner = expr.replace(/^`|`$/g, '')
  const pattern = inner.split('${_}').map(part => part.replace(/[.*+?^{}()|[\]\\]/g, String.raw`\$&`)).join('.+')
  return new RegExp(`^${pattern}$`)
})
const stillProtected = k => ast.bareStringCandidates.has(k) || astDynamicMatchers.some(re => re.test(k))
const unprotected = onlyRegex.filter(k => !stillProtected(k))

console.log(`\nkeys only the regex frontend found: ${onlyRegex.length}`
  + ` (${unprotected.length} not covered by AST candidates or dynamic keys)`)
for (const key of onlyRegex.slice(0, 25)) {
  console.log(`  - ${key}${stillProtected(key) ? '  (still protected)' : ''}`)
}
if (onlyRegex.length > 25) console.log(`  … and ${onlyRegex.length - 25} more`)

const onlyRegexDynamic = [...regexDynamic].filter(e => !astDynamic.has(e)).sort()
console.log(`\ndynamic expressions only the regex frontend found: ${onlyRegexDynamic.length}`)
for (const expr of onlyRegexDynamic.slice(0, 25)) console.log(`  - ${expr}`)

console.log(`\nkeys only the AST frontend found: ${onlyAst.length}`)
for (const key of onlyAst.slice(0, 25)) console.log(`  + ${key}`)
if (onlyAst.length > 25) console.log(`  … and ${onlyAst.length - 25} more`)

// A key the old frontend saw and the new one does not is the failure that
// matters: it becomes an orphan, and orphans get deleted.
if (unprotected.length > 0 || onlyRegexDynamic.length > 0) {
  console.log('\nKeys found only by the outgoing frontend would be reported as orphans.')
  console.log('Explain every one of them before adopting.')
}
