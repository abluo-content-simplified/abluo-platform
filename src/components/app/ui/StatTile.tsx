import type { ReactNode } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/** Change against the previous period. Only pass one when the previous period was really measured. */
export type StatDelta = {
  /** Whole-number % change (negative = down). */
  percent: number
  /** The previous period, worded to follow "vs" — e.g. "last week". */
  period: string
  /** Which direction is good news (colours it). Default 'up'. */
  goodWhen?: 'up' | 'down'
}

/**
 * One number on the dashboard: label, big value, optional change vs the
 * previous period, an optional sub-line, and optionally a link to the page
 * behind it. The change is always written out ("Up 25% on last week"), so
 * colour is never the only signal. `trend` is a slot for a future sparkline
 * (ADR-029 Phase 3) and renders under the value.
 */
export function StatTile({
  label,
  value,
  delta,
  sub,
  trend,
  href,
}: {
  label: string
  value: number
  delta?: StatDelta | null
  sub?: ReactNode
  trend?: ReactNode
  href?: string | null
}) {
  const t = useTranslations('app.ui.stat')
  const format = useFormatter()
  const dir = delta ? (delta.percent > 0 ? 'up' : delta.percent < 0 ? 'down' : 'flat') : null
  const tone =
    dir === null || dir === 'flat' ? 'text-muted-foreground' : dir === (delta?.goodWhen ?? 'up') ? 'text-success' : 'text-destructive'

  const content = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm leading-5 text-muted-foreground">{label}</span>
        {href ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
            <path d="m9 6 6 6-6 6" />
          </svg>
        ) : null}
      </span>
      <span className="text-[1.75rem] leading-9 font-semibold tracking-tight tabular-nums">{format.number(value)}</span>
      {trend}
      {delta && dir ? (
        <span className={`flex items-start gap-1 text-sm leading-5 ${tone}`}>
          {dir !== 'flat' ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="mt-1 shrink-0 fill-current">
              {dir === 'up' ? <path d="M6 2 11 10H1z" /> : <path d="M6 10 1 2h10z" />}
            </svg>
          ) : null}
          <span>{t(dir, { percent: Math.abs(delta.percent), period: delta.period })}</span>
        </span>
      ) : null}
      {sub ? <span className="text-sm leading-5 text-muted-foreground">{sub}</span> : null}
    </>
  )
  const frame = 'flex h-full min-h-11 flex-col items-stretch gap-1 rounded-xl border border-border bg-card p-4'
  return href ? (
    <Link href={href} className={`${frame} focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}>
      {content}
    </Link>
  ) : (
    <div className={frame}>{content}</div>
  )
}
