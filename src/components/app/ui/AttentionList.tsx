'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ATTENTION_MAX_SHOWN, splitAttention, type AttentionSeverity } from '@/lib/client/attention'

/** One row, already translated by the caller. */
export type AttentionRow = {
  id: string
  severity: AttentionSeverity
  title: string
  detail: string
  actionLabel: string
  href: string
}

function Marker({ severity }: { severity: AttentionSeverity }) {
  // Shape + text carry the meaning, not colour: a filled "!" for things to act
  // on, an outlined "i" for heads-ups.
  return severity === 'warn' ? (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0 text-foreground">
      <circle cx="10" cy="10" r="9" className="fill-current" />
      <path d="M10 5.5v5.5" className="stroke-background" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14.25" r="1.15" className="fill-background" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="10" cy="6.1" r="1.05" className="fill-current" />
    </svg>
  )
}

/**
 * "Needs your attention": short rows with a severity marker, a title, one
 * line of detail and an action, newest-most-important first (the caller
 * sorts). Shows `max` rows and a "Show N more" button for the rest; with no
 * rows it says "All caught up".
 */
export function AttentionList({
  items,
  max = ATTENTION_MAX_SHOWN,
  emptyTitle,
  emptyBody,
}: {
  items: AttentionRow[]
  max?: number
  emptyTitle?: string
  emptyBody?: string
}) {
  const t = useTranslations('app.ui.attention')
  const [all, setAll] = useState(false)
  if (!items.length) {
    return <EmptyState compact titleAs="p" title={emptyTitle ?? t('caughtUpTitle')} body={emptyBody ?? t('caughtUpBody')} />
  }
  const { shown, more } = splitAttention(items, max)
  const rows = all ? items : shown

  return (
    <div className="flex flex-col gap-2">
      <ul className="rounded-xl border border-border bg-card px-4">
        {rows.map((item) => (
          <li key={item.id} className="border-b border-border-subtle last:border-b-0">
            <Link
              href={item.href}
              className="flex min-h-11 items-start gap-3 py-3.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Marker severity={item.severity} />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{t(item.severity === 'warn' ? 'severityWarn' : 'severityInfo')}: </span>
                <span className="block text-[0.9375rem] leading-6 font-semibold">{item.title}</span>
                <span className="block text-sm leading-5 text-muted-foreground">{item.detail}</span>
                <span className="mt-1 block text-sm leading-5 font-semibold text-primary">{item.actionLabel}</span>
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="inline-flex min-h-11 items-center self-start rounded-md text-sm font-semibold text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {all ? t('showFewer') : t('showMore', { count: more })}
        </button>
      ) : null}
    </div>
  )
}
