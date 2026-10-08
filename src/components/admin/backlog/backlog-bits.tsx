'use client'

import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { BacklogPriority, BacklogStatus } from '@/lib/admin/backlog-model'

/**
 * Small display pieces of the admin Backlog. Colour is never the only signal:
 * every pill carries its word ("P0 · Urgent", "Blocked").
 */

const PRIORITY_TONE: Record<BacklogPriority, PillTone> = { p0: 'highlight', p1: 'outline', p2: 'muted', p3: 'muted' }

export function PriorityPill({ priority }: { priority: BacklogPriority }) {
  const t = useTranslations('admin.backlog.priority')
  return (
    <Pill
      tone={PRIORITY_TONE[priority]}
      icon={priority === 'p0' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" /> : undefined}
    >
      {t(priority)}
    </Pill>
  )
}

const STATUS_TONE: Record<BacklogStatus, PillTone> = {
  inbox: 'outline',
  planned: 'muted',
  in_progress: 'highlight',
  blocked: 'outline',
  done: 'success',
  wont_do: 'muted',
}

export function StatusPill({ status }: { status: BacklogStatus }) {
  const t = useTranslations('admin.backlog.status')
  return (
    <Pill
      tone={STATUS_TONE[status]}
      icon={status === 'blocked' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" /> : undefined}
    >
      {t(status)}
    </Pill>
  )
}

export const PRIMARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60'
export const SECONDARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60'
export const DESTRUCTIVE_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-destructive hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60'
export const CONTROL =
  'h-11 w-full rounded-xl border border-border bg-background px-3 text-[0.9375rem] leading-6 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export const PLUS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
