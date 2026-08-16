import en from '../translations/en.json' with { type: 'json' }

const messages = { en }
const locale = 'en'

/** Deliberately plain: no framework, no macro — just a lookup by dot path. */
export function t(key) {
  return key.split('.').reduce((node, part) => node?.[part], messages[locale]) ?? key
}

console.log(t('app.tagline'))
console.log(t('common.actions.save'))
console.log(t('booking.confirm'))
