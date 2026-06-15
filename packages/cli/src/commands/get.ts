import { createCommand, splitList } from './_shared.js'
import { getTranslations } from '../core/operations.js'

export default createCommand({
  name: 'get',
  description: 'Get translation values for specific keys',
  args: {
    layer: { type: 'string', description: 'Layer name', required: true },
    locale: { type: 'string', description: 'Locale code, or "*" for all', required: true },
    keys: { type: 'string', description: 'Comma-separated key paths', required: true },
  },
  async run(args) {
    const keys = splitList(args.keys) ?? []
    if (keys.length === 0) {
      throw new Error('No keys provided. Pass comma-separated key paths via --keys')
    }
    return getTranslations({ layer: args.layer, locale: args.locale, keys, projectDir: args.projectDir })
  },
})
