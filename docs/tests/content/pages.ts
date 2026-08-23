/** Shared by the content tests, which each walk the same tree. */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const CONTENT_DIR = join(import.meta.dirname, '../../content')

export interface ContentPage {
  /** Path relative to the content directory, for a failure message that locates the file. */
  name: string
  text: string
}

export function contentPages(): ContentPage[] {
  return readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { name: relative(CONTENT_DIR, path), text: readFileSync(path, 'utf-8') }
    })
}

/** The frontmatter block, or an empty string when the page has none. */
export function frontmatterOf(page: ContentPage): string {
  return /^---\n(.*?)\n---\n/s.exec(page.text)?.[1] ?? ''
}
