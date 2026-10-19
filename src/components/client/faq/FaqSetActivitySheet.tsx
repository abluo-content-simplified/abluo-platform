'use client'

/**
 * An FAQ set's Activity (ADR-037 D8, ADR-032 D9): a calm, read-only timeline
 * — what happened, who did it, when. Opened from the editor's menu. The same
 * wording as a post's activity (clientDashboard.activity).
 */

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { getFaqSetActivityAction } from '@/app/[locale]/(client)/[tenant]/faq-sets/actions'
import type { ActivityItem } from '@/lib/lifecycle/activity'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: ActivityItem[] }

export function FaqSetActivitySheet({ open, onClose, projectSlug, setId }: { open: boolean; onClose: () => void; projectSlug: string; setId: string }) {
  const t = useTranslations('clientDashboard.activity')
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !setId) return
    let live = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show loading for each opening
    setState({ kind: 'loading' })
    getFaqSetActivityAction({ projectSlug, id: setId })
      .then((r) => live && setState(r.ok ? { kind: 'ready', items: r.items } : { kind: 'error' }))
      .catch(() => live && setState({ kind: 'error' }))
    return () => {
      live = false
    }
  }, [open, setId, projectSlug, attempt])

  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    } catch {
      return iso
    }
  }
  const who = (a: ActivityItem['actor']) => (a.kind === 'person' ? t('actor.person', { name: a.name ?? '' }) : t(`actor.${a.kind}`))
  const what = (action: string) => (t.has(`action.${action}`) ? t(`action.${action}`) : action)

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
      ) : state.items.length === 0 ? (
        <div className="mt-2">
          <p className="text-[0.9375rem] font-medium">{t('empty')}</p>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ol className="mt-2 max-h-[60vh] divide-y divide-border overflow-y-auto">
          {state.items.map((item) => (
            <li key={item.id} className="py-3">
              <p className="text-[0.9375rem] font-medium">{what(item.action)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {who(item.actor)} · <time dateTime={item.at}>{when(item.at)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </BottomSheet>
  )
}
