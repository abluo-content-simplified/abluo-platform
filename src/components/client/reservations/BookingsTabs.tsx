'use client'

import { useTranslations } from 'next-intl'
import { Tabs } from '@/components/app/ui/Tabs'
import { useRouter } from '@/i18n/navigation'

/**
 * The two parts of the Bookings area (ADR-044 D16.15): the list and Booking
 * Rules. Each is its own page; the tab row sits at the top of both.
 */
export function BookingsTabs({ projectSlug, current }: { projectSlug: string; current: 'bookings' | 'rules' }) {
  const t = useTranslations('clientDashboard.bookings.tabs')
  const router = useRouter()
  return (
    <Tabs
      label={t('label')}
      value={current}
      onChange={(id) => {
        if (id !== current) router.push(id === 'rules' ? `/${projectSlug}/bookings/rules` : `/${projectSlug}/bookings`)
      }}
      items={[
        { id: 'bookings', label: t('bookings') },
        { id: 'rules', label: t('rules') },
      ]}
    />
  )
}
