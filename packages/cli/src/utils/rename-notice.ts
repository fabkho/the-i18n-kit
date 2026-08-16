/**
 * The kit is renaming to the `@the-i18n-kit` scope (#315). During the window
 * both names publish from one source at matching versions, so nothing breaks —
 * but a user on the old name has no way of learning that unless the package
 * tells them.
 *
 * A package finds out it is the old one by reading its own `name` at runtime,
 * which is why this takes the name rather than deciding for itself: the same
 * code ships under both names, and only the manifest differs.
 */

interface Rename {
  /** Where it moved to. */
  to: string
  /** How to move, phrased for whoever is going to read this particular notice. */
  how: string
}

const RENAMES: Record<string, Rename> = {
  'the-i18n-cli': {
    to: '@the-i18n-kit/cli',
    how: 'Install it with: npm i -g @the-i18n-kit/cli',
  },
  'the-i18n-mcp': {
    to: '@the-i18n-kit/mcp',
    how: 'Update your MCP client config to run: npx @the-i18n-kit/mcp@latest',
  },
}

/**
 * The notice for a package running under a legacy name, or null when it is
 * already running under its new one — which is the case that must stay silent,
 * since a notice there would be telling people to do what they have done.
 */
export function renameNotice(packageName: string): string | null {
  const rename = RENAMES[packageName]
  if (!rename) return null

  return `${packageName} is now ${rename.to}. Both names publish from the same source at the same versions, `
    + `and the old one will stop receiving updates. ${rename.how}`
}
