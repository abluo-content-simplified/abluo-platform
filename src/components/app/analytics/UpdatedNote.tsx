'use client'

import { useSyncExternalStore } from 'react'
import { useFormatter, useTranslations } from 'next-intl'

/**
 * "Updated 9 Oct, 16:25" in the READER's time zone (Tom 2026-10-09: the server
 * formatted it in UTC, two hours behind Italy). The server render, before the
 * browser's zone is known, says the time in UTC with the zone written out, so
 * it is never silently wrong; after hydration it switches to local time.
 */
export function UpdatedNote({ iso, stale }: { iso: string; stale: boolean }) {
  const t = useTranslations('app.analytics')
  const format = useFormatter()
  // Server snapshot = null (zone unknown → UTC, written out); in the browser, the reader's zone.
  const zone = useSyncExternalStore(noSubscribe, browserZone, () => null)
  const when = format.dateTime(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone ?? 'UTC',
    ...(zone ? {} : { timeZoneName: 'short' }),
  })
  return (
    <p className={`text-sm leading-5 ${stale ? 'text-destructive' : 'text-muted-foreground'}`}>
      <time dateTime={iso}>{stale ? t('staleNote', { when }) : t('updated', { when })}</time>
    </p>
  )
}

const noSubscribe = () => () => {}

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}
