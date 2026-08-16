import { describe, expect, it } from 'vitest'

// @ts-expect-error - a plain .mjs build script, deliberately not part of the TS project
import { mirrorManifest } from '../../../../scripts/mirror-package.mjs'

/**
 * The rename (#315) publishes each package a second time under its scoped
 * name, from one source at matching versions. The manifest rewrite is the only
 * part with judgement in it, and the only part that can be checked without
 * publishing something.
 */

const versions: Record<string, string> = {
  'the-i18n-cli': '4.8.1',
  'the-i18n-mcp': '7.2.0',
}
const versionOf = (dep: string) => versions[dep] ?? '0.0.0'

describe('the mirrored manifest', () => {
  it('renames the package and leaves everything else alone', () => {
    const mirrored = mirrorManifest(
      { name: 'the-i18n-cli', version: '4.8.1', bin: { 'the-i18n-cli': './dist/bin.js' } },
      '@the-i18n-kit/cli',
      versionOf,
    )

    expect(mirrored.name).toBe('@the-i18n-kit/cli')
    expect(mirrored.version).toBe('4.8.1')
    // The command a user types must not change with the package name.
    expect(mirrored.bin).toEqual({ 'the-i18n-cli': './dist/bin.js' })
  })

  // A scoped package depending on an unscoped one would leave the two halves
  // of the rename permanently tangled.
  it('repoints a dependency on a mirrored sibling at that sibling’s mirror', () => {
    const mirrored = mirrorManifest(
      { name: 'the-i18n-mcp', version: '7.2.0', dependencies: { 'the-i18n-cli': 'workspace:*', zod: '^4.3.6' } },
      '@the-i18n-kit/mcp',
      versionOf,
    )

    expect(mirrored.dependencies).toEqual({
      '@the-i18n-kit/cli': '^4.8.1',
      'zod': '^4.3.6',
    })
  })

  // npm cannot read a workspace: range; pnpm normally resolves it at publish
  // time, and this path does not use pnpm.
  it('resolves a workspace range even when the dependency is not being mirrored', () => {
    const mirrored = mirrorManifest(
      { name: 'the-i18n-mcp', version: '7.2.0', dependencies: { 'the-i18n-nuxt': 'workspace:^' } },
      '@the-i18n-kit/mcp',
      (dep: string) => (dep === 'the-i18n-nuxt' ? '0.1.3' : '0.0.0'),
    )

    expect(mirrored.dependencies).toEqual({ 'the-i18n-nuxt': '^0.1.3' })
  })

  it('rewrites optional peers the same way', () => {
    const mirrored = mirrorManifest(
      { name: 'the-i18n-cli', version: '4.8.1', peerDependencies: { '@nuxt/kit': '^3.0.0 || ^4.0.0' } },
      '@the-i18n-kit/cli',
      versionOf,
    )

    expect(mirrored.peerDependencies).toEqual({ '@nuxt/kit': '^3.0.0 || ^4.0.0' })
  })

  it('leaves a package with no dependencies untouched', () => {
    const mirrored = mirrorManifest({ name: 'the-i18n-cli', version: '4.8.1' }, '@the-i18n-kit/cli', versionOf)

    expect(mirrored).toEqual({ name: '@the-i18n-kit/cli', version: '4.8.1' })
  })
})
