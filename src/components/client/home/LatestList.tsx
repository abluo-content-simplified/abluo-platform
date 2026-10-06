'use client'

import { useSyncExternalStore } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export type LatestItem = {
  id: string
  title: string
  thumb: string | null
  href: string | null
  /** Posts: the publish state and go-live date (ISO), formatted in the browser. */
  status?: 'published' | 'scheduled' | 'offline'
  publishedAt?: string | null
  /** Galleries: a ready-made status line (where it is used). */
  line?: string
}

const noop = () => () => undefined

/**
 * Home · "Latest posts" / "Latest galleries": the three newest live or
 * scheduled items with a small thumbnail, title and a status line such as
 * "Published · 28 Sep" or "Scheduled · Tue 14 Oct, 09:00". Dates are
 * formatted in the browser, i.e. in the viewer's own time zone.
 */
export function LatestList({ heading, items, seeAllHref, kind }: { heading: string; items: LatestItem[]; seeAllHref: string; kind: 'post' | 'gallery' }) {
  const t = useTranslations('clientDashboard.home')
  const ui = useLocale()
  const client = useSyncExternalStore(noop, () => true, () => false)

  const when = (p: LatestItem): string => {
    if (p.line) return p.line
    if (!p.status) return ''
    if (p.status === 'offline') return t('recent.offline')
    if (!client || !p.publishedAt) return t(`recent.${p.status}`)
    const d = new Date(p.publishedAt)
    if (Number.isNaN(d.getTime())) return t(`recent.${p.status}`)
    const date =
      p.status === 'scheduled'
        ? new Intl.DateTimeFormat(ui, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
        : new Intl.DateTimeFormat(ui, { day: 'numeric', month: 'short' }).format(d)
    return t(`recent.${p.status}On`, { date })
  }

  return (
    <section className="flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-[1.0625rem] leading-6 font-semibold">{heading}</h2>
        <Link href={seeAllHref} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
          {t('seeAll')}
        </Link>
      </div>
      <ul className="rounded-xl border border-border bg-card px-3">
        {items.map((p) => {
          const body = (
            <>
              {p.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail, already sized
                <img src={p.thumb} alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-lg bg-muted object-cover" />
              ) : (
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <svg width="20" height="20" viewBox="0 0 24 24" className="fill-none stroke-current stroke-[1.5]">
                    {kind === 'gallery' ? <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01" /> : <path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6" />}
                  </svg>
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[0.9375rem] leading-[1.375rem] font-medium">{p.title}</span>
                <span className="block text-sm leading-5 text-muted-foreground">{when(p)}</span>
              </span>
            </>
          )
          return (
            <li key={p.id} className="border-b border-border-subtle last:border-b-0">
              {p.href ? (
                <Link href={p.href} className="flex min-h-11 items-start gap-3 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 py-3">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
