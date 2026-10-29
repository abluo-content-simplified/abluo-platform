'use client'

import { formatLastUpdate, type LastUpdateLabels } from '@/lib/support-tickets/time'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/**
 * A ticket's "last update" as date AND time in the viewer's own time zone
 * ("Today, 10:42"). Shared by the admin and client ticket screens: the caller
 * passes the translated "Today" / "Yesterday". The server renders it in its
 * own zone; the browser corrects it on hydration (hence the suppressed
 * warning, this node only).
 */
export function LastUpdate({ iso, labels, className = '' }: { iso: string | null | undefined; labels: LastUpdateLabels; className?: string }) {
  const dateLocale = useDateLocale()
  if (!iso) return null
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {formatLastUpdate(iso, { locale: dateLocale, labels })}
    </time>
  )
}
