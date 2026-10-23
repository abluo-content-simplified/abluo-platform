'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { formatLastUpdate } from '@/lib/support-tickets/time'
import { TICKET_LIMITS, type TicketDetail, type TicketStatus, type ThreadEntry } from '@/lib/support-tickets/model'

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

/** Date and time in the viewer's own time zone ("Today, 10:42"; the server's guess is corrected on hydration). */
export function TicketTime({ iso, className = '' }: { iso: string; className?: string }) {
  const locale = useLocale()
  const t = useTranslations('clientDashboard.supportTickets.time')
  const text = formatLastUpdate(iso, { locale, labels: { today: t('today'), yesterday: t('yesterday') } })
  if (!text) return null
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
        return e.to === 'removed_by_client' ? t('events.attachment_removed_by_client') : t('events.attachment_deleted')
      default:
        return null
    }
  }
}

/** The plain sentence under a status ("We're working on it"); resolved carries its own date and reply window. */
export function useStatusSentence(): (ticket: Pick<TicketDetail, 'status' | 'resolvedAt'>) => string {
  const t = useTranslations('clientDashboard.supportTickets.statusSentence')
  const locale = useLocale()
  return (ticket) => {
    if (ticket.status !== 'resolved') return t(ticket.status)
    const at = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null
    if (!at || Number.isNaN(at.getTime())) return t('resolvedNoDate')
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(at)
    const until = at.getTime() + TICKET_LIMITS.reopenDays * 86_400_000
    return Date.now() < until ? t('resolvedWindow', { date, days: TICKET_LIMITS.reopenDays }) : t('resolved', { date })
  }
}
