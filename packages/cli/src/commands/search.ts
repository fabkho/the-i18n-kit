import { createCommand } from './_shared.js'
import { searchTranslations } from '../core/operations.js'

export default createCommand({
  name: 'search',
  description: 'Search translation files by key or value',
  args: {
    query: { type: 'string', description: 'Search query (matched case-insensitively against keys and values)', required: true },
    in: { type: 'string', description: 'Where to search: keys, values, or both', default: 'both' },
    layer: { type: 'string', description: 'Filter to a specific layer' },
    locale: { type: 'string', description: 'Filter to a specific locale' },
  },
  async run(args) {
    const validSearchIn = ['keys', 'values', 'both'] as const
    const searchIn = validSearchIn.includes(args.in as typeof validSearchIn[number])
      ? (args.in as 'keys' | 'values' | 'both')
      : undefined
    if (args.in && !searchIn) {
      throw new Error(`Invalid --in value: "${args.in}". Must be one of: keys, values, both`)
    }
    return searchTranslations({
      query: args.query,
      searchIn,
      layer: args.layer,
      locale: args.locale,
      projectDir: args.projectDir,
    })
  },
})
