import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/bin.ts',
    'src/define-config.ts',
    // Its own entry because it is never imported — it is aliased to by path
    // while reading a project's vite.config, so it has to survive bundling as
    // a file. See config/framework/stubs/unplugin-vue-i18n.ts.
    'src/config/framework/stubs/unplugin-vue-i18n.ts',
    'src/config/framework/stubs/next-intl-routing.ts',
  ],
  // Never bundle the parser: it loads a platform-specific native binding at
  // runtime, and an inlined copy cannot find it (#332).
  external: ['oxc-parser'],
  format: 'esm',
  target: 'node18',
  clean: true,
  dts: true,
  sourcemap: true,
  onSuccess: async () => {
    // tsdown emits hashed .d.ts names; package.json points at stable ones, so
    // write a redirect per entry. An entry can produce several hashed chunks —
    // its own, plus shared ones it pulls in. The entry's own chunk is the one
    // nothing else imports.
    const { readdirSync, readFileSync, writeFileSync } = await import('node:fs')
    const files = readdirSync('dist')
    const dts = files.filter(f => f.endsWith('.d.ts'))
    const contents = dts.map(f => readFileSync(`dist/${f}`, 'utf-8')).join('\n')

    for (const entry of ['index', 'define-config']) {
      const entryChunk = dts.find(f => f.startsWith(`${entry}-`) && !contents.includes(f.replace(/\.d\.ts$/, '.js')))
      if (entryChunk) {
        writeFileSync(`dist/${entry}.d.ts`, `export * from './${entryChunk}';\n`)
      }
    }
  },
})
