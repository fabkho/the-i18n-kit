import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node18',
  dts: true,
  clean: true,
  // Resolved from the linted project at runtime, never bundled.
  external: ['eslint', '@intlify/eslint-plugin-vue-i18n', 'the-i18n-cli', 'jiti'],
  onSuccess: async () => {
    // tsdown emits a hashed .d.ts; package.json points at a stable name, so
    // write a redirect (same workaround as the CLI's tsdown config).
    const { readdirSync, writeFileSync } = await import('node:fs')
    const chunk = readdirSync('dist').find(f => /^index-.*\.d\.ts$/.test(f))
    if (chunk) {
      writeFileSync('dist/index.d.ts', `export * from './${chunk}';\nexport { default } from './${chunk}';\n`)
    }
  },
})
