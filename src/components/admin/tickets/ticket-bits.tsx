'use client'

import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import { LastUpdate } from '@/components/support-tickets/LastUpdate'
import type { TicketSeverity, TicketStatus } from '@/lib/support-tickets/model'

/** Status → pill tone (admin wording lives in admin.supportTickets.status.*). */
export const STATUS_TONE: Record<TicketStatus, PillTone> = { open: 'highlight', in_progress: 'success', waiting_for_user: 'muted', resolved: 'outline' }
export const SEVERITY_TONE: Record<TicketSeverity, PillTone> = { low: 'outline', normal: 'muted', high: 'highlight' }

export function StatusPill({ status }: { status: TicketStatus }) {
  const t = useTranslations('admin.supportTickets.status')
  return <Pill tone={STATUS_TONE[status]}>{t(status)}</Pill>
}

export function SeverityPill({ severity }: { severity: TicketSeverity }) {
  const t = useTranslations('admin.supportTickets.severity')
  return <Pill tone={SEVERITY_TONE[severity]}>{t(severity)}</Pill>
}

/** Last update with date and time in the viewer's local time ("Today, 10:42"). */
export function AdminLastUpdate({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const t = useTranslations('admin.supportTickets.time')
  return <LastUpdate iso={iso} className={className} labels={{ today: t('today'), yesterday: t('yesterday') }} />
}
