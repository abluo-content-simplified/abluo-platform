'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  exitSupportAction,
  requestSupportEditAction,
  showContactRequestsAction,
} from '@/app/[locale]/(client)/[tenant]/support-actions'
import type { SupportStatus } from '@/lib/support/state'

/**
 * The admin's persistent banner while visiting a client dashboard in support
 * mode (ADR-028 §8, docs/engineering/support-mode.md). Rendered by
 * `[tenant]/layout.tsx` only when the request's context is a support visit —
 * clients never see it. Shows the visit (site + role perspective), the
 * edit-access state (view only / waiting / allowed until HH:MM / declined /
 * expired / ended by the client) and the actions: ask to make changes, show
 * contact requests (logged), exit. While waiting it refreshes itself so the
 * client's answer shows up without a reload.
 */

/** HH:MM in the viewer's own time zone — formatted after mount, so server and browser never disagree. */
export function useLocalTime(iso: string | null): string {
  const locale = useLocale()
  const [text, setText] = useState('')
  useEffect(() => {
    if (!iso) return
    const d = new Date(iso)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's time zone is only known after mount
    if (!Number.isNaN(d.getTime())) setText(d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))
  }, [iso, locale])
  return text
}

const REFRESH_WHILE_WAITING_MS = 10_000

export function SupportBanner({
  site,
  role,
  status,
  expiresAt,
  contactRequestsHidden,
}: {
  site: string
  /** Localized role perspective (Owner / Site admin / Editor). */
  role: string
  status: SupportStatus
  expiresAt: string | null
  /** True when the site has contact requests and they are still hidden in this visit. */
  contactRequestsHidden: boolean
}) {
  const t = useTranslations('clientDashboard.support.banner')
  const router = useRouter()
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState(false)
  const until = useLocalTime(status === 'allowed' ? expiresAt : null)

  // Waiting for the client: pick up their answer. Allowed: notice the expiry.
  useEffect(() => {
    if (status !== 'requested' && status !== 'allowed') return
    const delay =
      status === 'allowed' && expiresAt ? Math.max(1_000, Math.min(Date.parse(expiresAt) - Date.now() + 1_000, 60_000)) : REFRESH_WHILE_WAITING_MS
    const id = window.setInterval(() => router.refresh(), delay)
    return () => window.clearInterval(id)
  }, [status, expiresAt, router])

  const run = (fn: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      setFailed(false)
      const r = await fn()
      if (!r.ok) setFailed(true)
      router.refresh()
    })

  const line =
    status === 'allowed'
      ? t('allowed', { time: until || '…' })
      : status === 'requested'
        ? t('requested')
        : status === 'declined'
          ? t('declined')
          : status === 'expired'
            ? t('expired')
            : status === 'revoked'
              ? t('revoked')
              : t('viewing')
  const canAsk = status === 'viewing' || status === 'declined' || status === 'expired' || status === 'revoked'

  const button =
    'inline-flex min-h-11 items-center rounded-lg border border-current px-3 text-sm font-medium hover:bg-admin-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

  return (
    <div
      role="region"
      aria-label={t('title', { site, role })}
      data-support-mode={status}
      className="sticky top-0 z-40 border-b border-admin-foreground/20 bg-admin px-4 py-3 text-admin-foreground md:px-6"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold leading-5">{t('title', { site, role })}</p>
          <p className="text-sm leading-5" aria-live="polite">
            {line}
            {contactRequestsHidden ? ` ${t('requestsHidden')}` : ''}
          </p>
          {failed ? (
            <p role="alert" className="text-sm font-medium leading-5">
              {t('error')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAsk ? (
            <button type="button" className={button} disabled={pending} onClick={() => run(requestSupportEditAction)}>
              {status === 'viewing' ? t('ask') : t('askAgain')}
            </button>
          ) : null}
          {contactRequestsHidden ? (
            <button type="button" className={button} disabled={pending} onClick={() => run(showContactRequestsAction)}>
              {t('showRequests')}
            </button>
          ) : null}
          <form action={exitSupportAction}>
            <button type="submit" className={`${button} bg-admin-foreground text-admin hover:bg-admin-foreground/90`}>
              {t('exit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
