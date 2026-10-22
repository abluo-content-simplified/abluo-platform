'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { TicketStatus, ThreadEntry } from '@/lib/support-tickets/model'

/** Status pill in the client's wording (Open / In Progress / Waiting for You / Resolved). */
const TONE: Record<TicketStatus, PillTone> = {
  open: 'muted',
  in_progress: 'outline',
  waiting_for_user: 'highlight',
  resolved: 'success',
}

export function TicketStatusPill({ status }: { status: TicketStatus }) {
  const t = useTranslations('clientDashboard.supportTickets.status')
  return <Pill tone={TONE[status]}>{t(status)}</Pill>
}

/** Date and time in the viewer's own time zone (the server's guess is corrected on hydration). */
export function TicketTime({ iso, className = '' }: { iso: string; className?: string }) {
  const locale = useLocale()
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const text = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {text}
    </time>
  )
}

/** The words for the thread's system lines (client side: only public events arrive). */
export function useEventFormatter(): (event: Extract<ThreadEntry, { kind: 'event' }>) => string | null {
  const t = useTranslations('clientDashboard.supportTickets')
  return (e) => {
    switch (e.event) {
      case 'created':
        return t('events.created')
      case 'status_changed':
        return e.to && ['open', 'in_progress', 'waiting_for_user', 'resolved'].includes(e.to) ? t('events.status_changed', { status: t(`status.${e.to as TicketStatus}`) }) : null
      case 'reopened_by_reply':
        return t('events.reopened_by_reply')
      case 'message_redacted':
        return t('events.message_removed')
      case 'attachment_deleted':
        return t('events.attachment_deleted')
      default:
        return null
    }
  }
}
