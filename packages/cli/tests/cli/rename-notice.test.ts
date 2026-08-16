import { describe, expect, it } from 'vitest'

import { renameNotice } from '../../src/utils/rename-notice.js'

/**
 * During the rename window (#315) both names publish from one source, so
 * nothing breaks — but a user on the old name has no way of finding out unless
 * the package says so. The same code ships under both names, which is why this
 * decides from the name it is given rather than from anything ambient.
 */

describe('the rename notice', () => {
  it('tells a legacy CLI where it moved and how to move with it', () => {
    const notice = renameNotice('the-i18n-cli')

    expect(notice).toContain('@the-i18n-kit/cli')
    expect(notice).toContain('npm i -g @the-i18n-kit/cli')
  })

  // The MCP server is not installed by hand — an editor runs it through npx —
  // so "npm i" would be the wrong instruction to give.
  it('tells a legacy MCP server to update its client config instead', () => {
    const notice = renameNotice('the-i18n-mcp')

    expect(notice).toContain('@the-i18n-kit/mcp')
    expect(notice).toContain('npx @the-i18n-kit/mcp@latest')
    expect(notice).not.toContain('npm i')
  })

  // The case that must stay silent: telling someone to do what they have done.
  it.each(['@the-i18n-kit/cli', '@the-i18n-kit/mcp', '@the-i18n-kit/nuxt'])(
    'says nothing when already running as %s',
    (name) => {
      expect(renameNotice(name)).toBeNull()
    },
  )

  it('says nothing for a package it knows nothing about', () => {
    expect(renameNotice('some-other-package')).toBeNull()
  })

  it('explains that both names work, so the notice does not read as a break', () => {
    const notice = renameNotice('the-i18n-cli')

    expect(notice).toContain('same source')
    expect(notice).toContain('stop receiving updates')
  })
})
