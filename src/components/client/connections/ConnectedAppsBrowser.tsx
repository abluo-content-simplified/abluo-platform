'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { ConnectionSummary } from '@/lib/connections/manage'
import { PAUSED_BY_TENANT } from '@/lib/connections/manage-constants'
import {
  disconnectConnectionAction,
  pauseConnectionAction,
  resumeConnectionAction,
  type ConnectionActionResult,
} from '@/app/[locale]/(client)/[tenant]/apps/actions'

const TONE: Record<string, PillTone> = { active: 'success', paused: 'outline', needs_reconnect: 'highlight' }
const ERRORS = ['forbidden', 'support_mode', 'not_found', 'invalid_state'] as const

/**
 * Connected apps (ADR-031 D8.4): one card per partner app reading this site —
 * status, what it reads, when it last did — with pause / resume / disconnect.
 * Few rows by nature, so cards on every screen size. Every action is
 * re-checked on the server.
 */
export function ConnectedAppsBrowser({
  title,
  projectSlug,
  locale,
  connections,
  readOnly,
}: {
  title: string
  projectSlug: string
  locale: string
  connections: ConnectionSummary[]
  readOnly: boolean
}) {
  const t = useTranslations('clientDashboard.connections')
  const tRes = useTranslations('clientDashboard.connect.resources')
  const router = useRouter()
  const { toast, show } = useUndo()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ConnectionSummary | null>(null)
  // Disconnected cards disappear at once; restored if the server refuses.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const visible = connections.filter((c) => !hidden.has(c.id))

  function disconnect(c: ConnectionSummary) {
    setConfirm(null)
    setHidden((h) => new Set(h).add(c.id))
    void run(() => disconnectConnectionAction({ ...base, connectionId: c.id }), t('disconnected', { app: c.appName })).then((ok) => {
      if (!ok)
        setHidden((h) => {
          const next = new Set(h)
          next.delete(c.id)
          return next
        })
    })
  }

  async function run(action: () => Promise<ConnectionActionResult>, done: string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      const r = await action()
      if (!r.ok) {
        show({ message: t(ERRORS.includes(r.error as never) ? `errors.${r.error}` : 'errors.failed'), tone: 'error' })
        return false
      }
      show({ message: done, tone: 'status' })
      router.refresh()
      return true
    } catch {
      show({ message: t('errors.failed'), tone: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const base = { projectSlug, locale }
  const menuFor = (c: ConnectionSummary): CardMenuItem[] => {
    if (readOnly) return []
    const items: CardMenuItem[] = []
    if (c.status === 'active') items.push({ key: 'pause', label: t('pause'), onSelect: () => void run(() => pauseConnectionAction({ ...base, connectionId: c.id }), t('paused', { app: c.appName })) })
    if (c.status === 'paused' && c.statusReason === PAUSED_BY_TENANT)
      items.push({ key: 'resume', label: t('resume'), onSelect: () => void run(() => resumeConnectionAction({ ...base, connectionId: c.id }), t('resumed', { app: c.appName })) })
    items.push({ key: 'disconnect', label: t('disconnect'), onSelect: () => setConfirm(c), destructive: true })
    return items
  }

  const notice = (c: ConnectionSummary): string | null => {
    if (c.status === 'needs_reconnect') return t('notice.needsReconnect', { app: c.appName })
    if (c.awaitingApp) return t('notice.awaitingApp', { app: c.appName })
    if (c.status === 'paused') return c.statusReason === PAUSED_BY_TENANT ? t('notice.pausedByYou', { app: c.appName }) : t('notice.pausedByAbluo', { app: c.appName })
    return null
  }

  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>

      {visible.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {visible.map((c) => {
            const items = menuFor(c)
            const note = notice(c)
            return (
              <Panel as="li" key={c.id} className="flex flex-col gap-3 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h2 className="truncate text-[1.0625rem] leading-6 font-semibold text-foreground">{c.appName}</h2>
                    <span className="flex flex-wrap gap-1.5">
                      {c.awaitingApp ? (
                        <Pill tone="outline">{t('status.awaiting')}</Pill>
                      ) : (
                        <Pill tone={TONE[c.status] ?? 'muted'}>{t(`status.${c.status}` as 'status.active')}</Pill>
                      )}
                      {c.sandbox ? <Pill tone="muted">{t('sandbox')}</Pill> : null}
                    </span>
                  </div>
                  {items.length ? <CardMenu label={t('actionsFor', { app: c.appName })} items={items} /> : null}
                </div>
                {note ? <p className="rounded-xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">{note}</p> : null}
                <dl>
                  <FactRow label={t('facts.reads')}>
                    {c.reads
                      .map((r) => {
                        const what = tRes(r.resource as 'event')
                        const label = r.scope === 'all' ? what : t('facts.readsSome', { what })
                        return r.personal ? t('facts.readsWithPeople', { what: label }) : label
                      })
                      .join(' · ')}
                  </FactRow>
                  <FactRow label={t('facts.lastUsed')}>
                    <LocalDate iso={c.lastUsedAt} empty={t('facts.never')} />
                  </FactRow>
                  <FactRow label={t('facts.connected')}>
                    <LocalDate iso={c.connectedAt} />
                  </FactRow>
                </dl>
              </Panel>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={t('disconnectConfirm.title', { app: confirm?.appName ?? '' })}
        body={t('disconnectConfirm.body', { app: confirm?.appName ?? '' })}
        confirmLabel={t('disconnect')}
        busy={busy}
        onConfirm={() => confirm && disconnect(confirm)}
        onCancel={() => setConfirm(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
