'use client'

/**
 * A post's Activity (ADR-032 D9): a calm, read-only timeline — what happened,
 * who did it, when — in the site's time zone with its offset (D8). Opened from
 * the post's menu (list and editor). Everything technical stays on the server.
 */

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { getPostActivityAction, type PostActivityResult } from '@/app/[locale]/(client)/[tenant]/posts/activity-actions'
import type { ActivityItem } from '@/lib/lifecycle/activity'

type State = { kind: 'loading' } | { kind: 'error' } | ({ kind: 'ready' } & Extract<PostActivityResult, { ok: true }>)

export function PostActivitySheet({ open, onClose, projectSlug, postId }: { open: boolean; onClose: () => void; projectSlug: string; postId: string | null }) {
  const t = useTranslations('clientDashboard.activity')
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !postId) return
    let live = true
    setState({ kind: 'loading' })
    getPostActivityAction({ projectSlug, id: postId })
      .then((r) => live && setState(r.ok ? { kind: 'ready', ...r } : { kind: 'error' }))
      .catch(() => live && setState({ kind: 'error' }))
    return () => {
      live = false
    }
  }, [open, postId, projectSlug, attempt])

  const when = (iso: string, timeZone: string | null) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(timeZone && { timeZone }),
      }).format(new Date(iso))
    } catch {
      return new Date(iso).toLocaleString(locale)
    }
  }
  const who = (a: ActivityItem['actor']) => (a.kind === 'person' ? t('actor.person', { name: a.name ?? '' }) : t(`actor.${a.kind}`))

  return (
    <BottomSheet open={open} title={t('title')} onClose={onClose}>
      {state.kind === 'loading' ? (
        <p className="mt-2 text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : state.kind === 'error' ? (
        <div className="mt-2" role="alert">
          <p className="text-[0.9375rem] text-muted-foreground">{t('error')}</p>
          <Button className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <div className="mt-2">
          {state.window ? (
            <p className="mb-3 rounded-xl bg-muted px-3 py-2 text-[0.9375rem]">{t(`window.${state.window.kind}`, { date: when(state.window.at, state.timeZone) })}</p>
          ) : null}
          {state.items.length === 0 ? (
            <div>
              <p className="text-[0.9375rem] font-medium">{t('empty')}</p>
              <p className="mt-1 text-[0.9375rem] text-muted-foreground">{t('emptyHint')}</p>
            </div>
          ) : (
            <ol className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {state.items.map((item) => (
                <li key={item.id} className="py-3">
                  <p className="text-[0.9375rem] font-medium">{t(`action.${item.action}`)}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {who(item.actor)} · <time dateTime={item.at}>{when(item.at, state.timeZone)}</time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
