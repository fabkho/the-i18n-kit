import { describe, expect, it } from 'vitest'

import module from '../src/module'

describe('module definition', () => {
  it('declares the name and config key consumers write in nuxt.config', () => {
    expect(module.getMeta).toBeDefined()
  })

  it('exposes its meta for Nuxt to resolve compatibility against', async () => {
    const meta = await module.getMeta!()

    expect(meta.name).toBe('@the-i18n-kit/nuxt')
    expect(meta.configKey).toBe('i18nKit')
  })
})
