'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { SetupItem } from '@/lib/client/setup-checklist'
import { hideSetupChecklistAction } from '@/app/[locale]/(client)/[tenant]/home/actions'

/**
 * "Get your site ready" on Home: a small, calm card listing the first steps,
 * each ticked off from real data (`buildSetupChecklist`). Open items link to
 * where you do them; done items stay, quietly ticked, so progress is visible.
 * "Hide checklist" stores the choice for this person on this project and the
 * card goes away; it also goes away by itself once everything is done.
 */
export function SetupChecklist({
  projectSlug,
  items,
  doneCount,
  total,
  canHide,
}: {
  projectSlug: string
  items: SetupItem[]
  doneCount: number
  total: number
  /** False until migration 039 is applied (nowhere to store the choice). */
  canHide: boolean
}) {
  const t = useTranslations('clientDashboard.home.setup')
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, start] = useTransition()
  if (hidden) return null

  function hide() {
    setFailed(false)
    start(async () => {
      const r = await hideSetupChecklistAction({ projectSlug })
      if (r.ok) {
        setHidden(true)
        router.refresh()
      } else setFailed(true)
    })
  }

  return (
    <section aria-labelledby="setup-checklist" className="rounded-xl border border-border bg-card px-4 pt-4 pb-2">
      <div className="flex items-start justify-between gap-3">
        <h2 id="setup-checklist" className="text-[1.0625rem] leading-6 font-semibold">
          {t('heading')}
        </h2>
        <span className="shrink-0 text-sm leading-6 text-muted-foreground">{t('progress', { done: doneCount, total })}</span>
      </div>
      <div
        className="mt-2.5 h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneCount}
        aria-label={t('progress', { done: doneCount, total })}
      >
        <span className="block h-full rounded-full bg-foreground" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
      </div>

      <ul className="mt-2">
        {items.map((item) => {
          const body = (
            <>
              {item.done ? (
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0 text-foreground">
                  <circle cx="10" cy="10" r="9" className="fill-current" />
                  <path d="m6 10.2 2.6 2.6L14 7.4" fill="none" className="stroke-background" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
                  <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
              <span className="min-w-0 flex-1">
                <span className="sr-only">{t(item.done ? 'doneLabel' : 'todoLabel')}: </span>
                <span className={`block text-[0.9375rem] leading-6 ${item.done ? 'text-muted-foreground' : 'font-semibold'}`}>
                  {t(`items.${item.id}.title`)}
                </span>
                <span className="block text-sm leading-5 text-muted-foreground">
                  {t(item.done ? `items.${item.id}.doneDetail` : `items.${item.id}.detail`)}
                </span>
              </span>
              {!item.done && item.href ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              ) : null}
            </>
          )
          return (
            <li key={item.id} className="border-b border-border-subtle last:border-b-0">
              {!item.done && item.href ? (
                <Link
                  href={item.href}
                  className="flex min-h-11 items-start gap-3 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-11 items-start gap-3 py-3">{body}</div>
              )}
            </li>
          )
        })}
      </ul>

      {canHide ? (
        <div className="flex flex-col items-start border-t border-border-subtle pt-1">
          <button
            type="button"
            onClick={hide}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          >
            {t('hide')}
          </button>
          {failed ? (
            <p role="alert" className="pb-2 text-sm text-muted-foreground">
              {t('hideFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
