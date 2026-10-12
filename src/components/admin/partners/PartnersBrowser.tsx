'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { PartnerAppOverview } from '@/lib/connections/admin'
import {
  approvePartnerAppAction,
  registerPartnerAppAction,
  rotatePartnerSecretAction,
  suspendPartnerAppAction,
  type PartnerActionResult,
} from '@/app/[locale]/(admin)/partners/actions'

const APP_TONE: Record<string, PillTone> = { approved: 'success', pending: 'highlight', suspended: 'outline' }
const CONN_TONE: Record<string, PillTone> = { active: 'success', paused: 'outline', needs_reconnect: 'highlight' }
const ERRORS = ['forbidden', 'invalid_input', 'not_found', 'invalid_state'] as const

const primary =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none'
const secondary =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const input =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-[0.9375rem] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

type Revealed = { appName: string; clientId?: string; clientSecret: string }

/**
 * Partner apps (ADR-031 D8.2). Register → the client id and secret are shown
 * ONCE for the partner to put in its server configuration (never emailed);
 * approve to let it request Connect; suspend to pause every Connection at
 * once; a lost secret is replaced, not shown again.
 */
export function PartnersBrowser({ title, apps }: { title: string; apps: PartnerAppOverview[] }) {
  const t = useTranslations('admin.partners')
  const router = useRouter()
  const { toast, show } = useUndo()
  const [busy, setBusy] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [form, setForm] = useState({ name: '', redirectUris: '', contactEmail: '' })
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'suspend' | 'rotate'; app: PartnerAppOverview } | null>(null)

  async function run(action: () => Promise<PartnerActionResult>, done?: string): Promise<PartnerActionResult | null> {
    if (busy) return null
    setBusy(true)
    try {
      const r = await action()
      if (!r.ok) {
        show({ message: t(ERRORS.includes(r.error as never) ? (`errors.${r.error}` as 'errors.failed') : 'errors.failed'), tone: 'error' })
        return r
      }
      if (done) show({ message: done, tone: 'status' })
      router.refresh()
      return r
    } catch {
      show({ message: t('errors.failed'), tone: 'error' })
      return null
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    const r = await run(() => registerPartnerAppAction(form))
    if (r?.ok && r.clientSecret) {
      setRegistering(false)
      setRevealed({ appName: form.name.trim(), clientId: r.clientId, clientSecret: r.clientSecret })
      setForm({ name: '', redirectUris: '', contactEmail: '' })
    }
  }

  const menuFor = (a: PartnerAppOverview): CardMenuItem[] => {
    const items: CardMenuItem[] = []
    if (a.status !== 'approved') items.push({ key: 'approve', label: t('approve'), onSelect: () => void run(() => approvePartnerAppAction(a.id), t('approved', { app: a.name })) })
    if (a.status === 'approved') items.push({ key: 'suspend', label: t('suspend'), onSelect: () => setConfirm({ kind: 'suspend', app: a }), destructive: true })
    items.push({ key: 'rotate', label: t('rotate'), onSelect: () => setConfirm({ kind: 'rotate', app: a }) })
    return items
  }

  const onConfirm = async () => {
    if (!confirm) return
    const { kind, app } = confirm
    if (kind === 'suspend') {
      await run(() => suspendPartnerAppAction(app.id), t('suspended', { app: app.name }))
    } else {
      const r = await run(() => rotatePartnerSecretAction(app.id))
      if (r?.ok && r.clientSecret) setRevealed({ appName: app.name, clientId: app.clientId, clientSecret: r.clientSecret })
    }
    setConfirm(null)
  }

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => show({ message: t('copied'), tone: 'status' }),
      () => undefined,
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          <button type="button" className={primary} onClick={() => setRegistering(true)}>
            {t('register')}
          </button>
        }
      />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>

      {apps.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <ul className="space-y-4">
          {apps.map((a) => (
            <li key={a.id} className="space-y-3 rounded-2xl border border-border bg-card p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h2 className="truncate text-[1.0625rem] leading-6 font-semibold text-foreground">{a.name}</h2>
                  <span>
                    <Pill tone={APP_TONE[a.status] ?? 'muted'}>{t(`status.${a.status}` as 'status.approved')}</Pill>
                  </span>
                </div>
                <CardMenu label={t('actionsFor', { app: a.name })} items={menuFor(a)} />
              </div>
              <dl>
                <FactRow label={t('facts.clientId')}>
                  <code className="text-sm break-all">{a.clientId}</code>
                </FactRow>
                <FactRow label={t('facts.redirects')}>
                  <span className="flex flex-col items-end gap-0.5">
                    {a.redirectUris.map((u) => (
                      <code key={u} className="text-sm break-all">
                        {u}
                      </code>
                    ))}
                  </span>
                </FactRow>
                {a.contactEmail ? <FactRow label={t('facts.contact')}>{a.contactEmail}</FactRow> : null}
                <FactRow label={t('facts.registered')}>
                  <LocalDate iso={a.createdAt} />
                </FactRow>
              </dl>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{t('connectionsTitle', { count: a.connections.length })}</h3>
                {a.connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noConnections')}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {a.connections.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <span className="text-[0.9375rem] text-foreground">{c.projectName}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {c.sandbox ? <Pill tone="muted">{t('sandbox')}</Pill> : null}
                          <Pill tone={CONN_TONE[c.status] ?? 'muted'}>{t(`connectionStatus.${c.status}` as 'connectionStatus.active')}</Pill>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={registering} title={t('registerTitle')} onClose={() => setRegistering(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void register()
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t('form.name')}</span>
            <input className={input} value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t('form.redirects')}</span>
            <textarea
              className={`${input} min-h-24 font-mono text-sm`}
              value={form.redirectUris}
              required
              placeholder="https://partner.example/abluo/callback"
              onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
            />
            <span className="block text-sm text-muted-foreground">{t('form.redirectsHelp')}</span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t('form.contact')}</span>
            <input className={input} type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </label>
          <p className="text-sm text-muted-foreground">{t('form.pendingNote')}</p>
          <div className="flex justify-end gap-3">
            <button type="button" className={secondary} onClick={() => setRegistering(false)}>
              {t('cancel')}
            </button>
            <button type="submit" className={primary} disabled={busy}>
              {t('register')}
            </button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet open={revealed !== null} title={t('secret.title', { app: revealed?.appName ?? '' })} onClose={() => setRevealed(null)}>
        {revealed ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">
              {t('secret.warning')}
            </p>
            {revealed.clientId ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">{t('facts.clientId')}</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2.5 text-sm break-all">{revealed.clientId}</code>
                  <button type="button" className={secondary} onClick={() => copy(revealed.clientId!)}>
                    {t('copy')}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">{t('secret.label')}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2.5 text-sm break-all">{revealed.clientSecret}</code>
                <button type="button" className={secondary} onClick={() => copy(revealed.clientSecret)}>
                  {t('copy')}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" className={primary} onClick={() => setRevealed(null)}>
                {t('secret.done')}
              </button>
            </div>
          </div>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t(`${confirm.kind}Confirm.title`, { app: confirm.app.name }) : ''}
        body={confirm ? t(`${confirm.kind}Confirm.body`, { app: confirm.app.name, count: confirm.app.connections.length }) : ''}
        confirmLabel={confirm?.kind === 'rotate' ? t('rotate') : t('suspend')}
        busy={busy}
        onConfirm={() => void onConfirm()}
        onCancel={() => setConfirm(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
