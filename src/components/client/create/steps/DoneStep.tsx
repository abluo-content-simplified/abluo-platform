'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export type DoneResult =
  | { kind: 'live'; url: string | null }
  | { kind: 'scheduled'; at: string }
  | { kind: 'draft' }
  | { kind: 'updated'; live: boolean; url: string | null }

/** The final screen: live / scheduled / saved as draft, with the way back. */
export function DoneStep({ result, homeHref }: { result: DoneResult; homeHref: string }) {
  const t = useTranslations('clientDashboard.create.done')
  const ui = useLocale()
  const when =
    result.kind === 'scheduled'
      ? new Intl.DateTimeFormat(ui, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(result.at))
      : ''
  const heading =
    result.kind === 'live'
      ? t('live')
      : result.kind === 'scheduled'
        ? t('scheduled')
        : result.kind === 'updated'
          ? result.live
            ? t('updated')
            : t('updatedNotLive')
          : t('draft')
  const body =
    result.kind === 'live'
      ? t('liveBody')
      : result.kind === 'scheduled'
        ? t('scheduledBody', { date: when })
        : result.kind === 'updated'
          ? result.live
            ? t('updatedBody')
            : t('updatedNotLiveBody')
          : t('draftBody')
  const url = result.kind === 'live' || result.kind === 'updated' ? result.url : null

  return (
    <section aria-labelledby="done-step-title" className="flex flex-col items-start pt-10">
      <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-muted text-success">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
      </span>
      <h1 id="done-step-title" className="mt-6 text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {heading}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{body}</p>
      <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-14 items-center justify-center rounded-xl bg-action px-6 text-[1.0625rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('view')}
          </a>
        ) : null}
        <Link
          href={homeHref}
          className={`inline-flex h-14 items-center justify-center rounded-xl px-6 text-[1.0625rem] font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            url ? 'border border-border text-foreground hover:bg-hover' : 'bg-action text-action-foreground'
          }`}
        >
          {t('home')}
        </Link>
      </div>
    </section>
  )
}
