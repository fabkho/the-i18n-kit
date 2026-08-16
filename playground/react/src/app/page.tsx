import { useTranslations } from 'next-intl'

/**
 * Here so the scanner has real call sites to find. `booking.slotsLeft` is used
 * but only translated in two locales, which is what `missing` reports.
 */
export default function Home() {
  const t = useTranslations()

  return (
    <main>
      <h1>{t('common.navigation.home')}</h1>
      <p>{t('booking.slotsLeft', { count: 3 })}</p>
      <button type="button">{t('common.actions.save')}</button>
      <button type="button">{t('booking.confirm')}</button>
    </main>
  )
}
