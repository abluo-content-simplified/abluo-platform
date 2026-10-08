import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * A card that goes somewhere: icon tile, title (+ optional badge), one
 * subline and a trailing arrow — e.g. "View your site", Help, account rows.
 * Content is top-aligned (the title lines up with the top of the icon).
 *
 * `external` opens a new tab and tells screen readers so. Without `href` the
 * card renders as a plain, non-interactive block with no arrow.
 */
export function LinkCard({
  href,
  external = false,
  icon,
  title,
  badge,
  subline,
  className = '',
}: {
  href?: string | null
  external?: boolean
  icon: ReactNode
  title: ReactNode
  badge?: ReactNode
  subline?: ReactNode
  className?: string
}) {
  const t = useTranslations('app.ui.linkCard')
  const body = (
    <>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <span className="text-[0.9375rem] leading-6 font-semibold">{title}</span>
          {badge}
        </span>
        {subline ? <span className="block truncate text-sm leading-5 text-muted-foreground">{subline}</span> : null}
      </span>
    </>
  )
  const frame = `flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 ${className}`
  if (!href) return <div className={frame}>{body}</div>

  const arrow = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground">
      {external ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="m9 6 6 6-6 6" />}
    </svg>
  )
  const focus = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${frame} ${focus}`}>
        {body}
        {arrow}
        <span className="sr-only">{t('opensNewTab')}</span>
      </a>
    )
  }
  return (
    <Link href={href} className={`${frame} ${focus}`}>
      {body}
      {arrow}
    </Link>
  )
}
