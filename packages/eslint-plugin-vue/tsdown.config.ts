import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/nuxt.ts'],
  format: 'esm',
  target: 'node18',
  dts: true,
  clean: true,
  // Resolved from the linted project at runtime, never bundled.
  external: ['eslint', '@intlify/eslint-plugin-vue-i18n', '@the-i18n-kit/cli', 'jiti'],
  onSuccess: async () => {
    // tsdown emits hashed .d.ts names; package.json points at stable ones, so
    // write a redirect per entry (same workaround as the CLI's tsdown config).
    // Only the plugin entry has a default export to re-export.
    const { readdirSync, writeFileSync } = await import('node:fs')
    const files = readdirSync('dist')
    for (const entry of ['index', 'nuxt'] as const) {
      const chunk = files.find(f => f.startsWith(`${entry}-`) && f.endsWith('.d.ts'))
      if (!chunk) continue
      const redirect = `export * from './${chunk}';\n`
        + (entry === 'index' ? `export { default } from './${chunk}';\n` : '')
      writeFileSync(`dist/${entry}.d.ts`, redirect)
    }
  },
})
