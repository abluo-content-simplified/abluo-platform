'use client'

import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { LifecycleStatus } from '@/lib/lifecycle/status'

/**
 * ADR-032 slice 6 — the one status badge for lifecycle content (posts now;
 * events, galleries, Menu later): Draft · Scheduled · Published · Unpublished ·
 * Archived, plus "Pending changes" when a draft sits next to the published
 * version. 1.5rem pills; `oneLine` never wraps (the second pill truncates).
 */
const TONE: Record<LifecycleStatus, PillTone> = { draft: 'outline', scheduled: 'highlight', published: 'success', unpublished: 'muted', archived: 'muted' }

const svg = (d: string) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const ICON: Partial<Record<LifecycleStatus, React.ReactNode>> = {
  published: <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />,
  scheduled: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2'),
  archived: svg('M3 4h18v4H3zM5 8v12h14V8M10 12h4'),
}

export function LifecycleBadge({ status, changes = false, extra, oneLine = false }: { status: LifecycleStatus; changes?: boolean; extra?: string | null; oneLine?: boolean }) {
  const t = useTranslations('app.lifecycle')
  const second = extra ?? (changes ? t('pendingChanges') : null)
  return (
    <span className={`flex items-start gap-1.5 ${oneLine ? 'min-w-0 flex-nowrap overflow-hidden' : 'flex-wrap'}`}>
      <Pill tone={TONE[status]} icon={ICON[status]}>
        {t(`status.${status}`)}
      </Pill>
      {second ? (
        <span
          title={second}
          className={`h-6 rounded-full border border-border px-2.5 text-xs leading-[1.375rem] font-medium whitespace-nowrap text-foreground ${oneLine ? 'block min-w-0 truncate' : 'inline-flex shrink-0 items-center'}`}
        >
          {second}
        </span>
      ) : null}
    </span>
  )
}
