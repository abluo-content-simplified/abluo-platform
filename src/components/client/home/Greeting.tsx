'use client'

import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { partOfDay, type PartOfDay } from '@/lib/client/home-cards'

const noop = () => () => undefined

/**
 * "Good morning, Paolo" — by the viewer's LOCAL time, so it is worked out in
 * the browser (the server doesn't know the time zone). Before that, and when
 * there is no first name, it says "Welcome back".
 */
export function Greeting({ firstName }: { firstName: string | null }) {
  const t = useTranslations('clientDashboard.home.greeting')
  const part = useSyncExternalStore<PartOfDay | null>(noop, () => partOfDay(new Date().getHours()), () => null)
  return (
    <h1 className="text-2xl leading-[1.875rem] font-semibold tracking-tight">
      {firstName && part ? t(part, { name: firstName }) : t('welcome')}
    </h1>
  )
}
