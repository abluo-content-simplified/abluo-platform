'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { Field } from '@/components/app/ui/Field'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellDate, CellPill, CellText, LocalDate, Pill, type PillTone } from '@/components/app/ui/list/cells'
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

const STATUS_FILTERS = ['all', 'pending', 'approved', 'suspended'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
type SortColumn = 'name' | 'status' | 'registered'
type Sort = { column: SortColumn; dir: 'asc' | 'desc' }
const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, suspended: 2 }

/** Lower-case, accent-free, so "citta" finds "Città". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Everything the search box matches: name, client id, contact, return addresses, connected sites. */
const searchText = (a: PartnerAppOverview) =>
  fold([a.name, a.clientId, a.contactEmail ?? '', ...a.redirectUris, ...a.connections.map((c) => c.projectName)].join(' '))

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
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<Sort>({ column: 'name', dir: 'asc' })
  const [openId, setOpenId] = useState<string | null>(null)

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

  const terms = fold(q).split(/\s+/).filter(Boolean)
  const matches = (a: PartnerAppOverview, st: StatusFilter, ts: string[]) =>
    (st === 'all' || a.status === st) && (ts.length === 0 || ts.every((term) => searchText(a).includes(term)))
  const dir = sort.dir === 'asc' ? 1 : -1
  const sortKey = (a: PartnerAppOverview): number | string =>
    sort.column === 'status' ? (STATUS_ORDER[a.status] ?? 3) : sort.column === 'registered' ? Date.parse(a.createdAt) || 0 : fold(a.name)
  const shown = apps
    .filter((a) => matches(a, status, terms))
    .sort((a, b) => {
      const ka = sortKey(a)
      const kb = sortKey(b)
      return ka === kb ? fold(a.name).localeCompare(fold(b.name)) : (ka < kb ? -1 : 1) * dir
    })
  const isDefault = !q.trim() && status === 'all'
  const reset = () => {
    setQ('')
    setStatus('all')
  }
  const onSort = (key: string) =>
    setSort((cur) => (cur.column === key ? { column: cur.column, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { column: key as SortColumn, dir: key === 'registered' ? 'desc' : 'asc' }))
  const filters: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('statusFilter'),
      value: status,
      options: STATUS_FILTERS.map((st) => ({ value: st, label: `${t(`statusFilters.${st}`)} (${apps.filter((a) => matches(a, st, [])).length})` })),
      onChange: (v) => setStatus(v as StatusFilter),
    },
  ]
  const chips: FilterChip[] = status !== 'all' ? [{ id: 'status', label: t(`statusFilters.${status}`) }] : []
  const openApp = apps.find((a) => a.id === openId) ?? null

  const columns: DataTableColumn<PartnerAppOverview>[] = [
    {
      key: 'name',
      header: t('columns.app'),
      sortable: true,
      width: 'min-w-56',
      render: (a) => <CellText clamp={1} primary={a.name} secondary={<span className="font-mono text-xs break-all">{a.clientId}</span>} secondaryLines={1} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      width: 'w-32',
      render: (a) => (
        <CellPill>
          <Pill tone={APP_TONE[a.status] ?? 'muted'}>{t(`status.${a.status}` as 'status.approved')}</Pill>
        </CellPill>
      ),
    },
    {
      key: 'contact',
      header: t('columns.contact'),
      width: 'w-52',
      render: (a) => <span className="line-clamp-1 text-sm leading-6 break-all text-muted-foreground">{a.contactEmail ?? '—'}</span>,
    },
    {
      key: 'connections',
      header: t('columns.connections'),
      width: 'w-28',
      render: (a) => <span className="flex min-h-6 items-center text-sm text-foreground">{a.connections.length}</span>,
    },
    { key: 'registered', header: t('columns.registered'), sortable: true, width: 'w-32', render: (a) => <CellDate iso={a.createdAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (a) => <CardMenu variant="cell" label={t('actionsFor', { app: a.name })} items={menuFor(a)} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          <Button variant="primary" onClick={() => setRegistering(true)}>
            {t('register')}
          </Button>
        }
      />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>

      {apps.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <ListToolbar
            label={t('filters')}
            search={{ value: q, onChange: setQ, label: t('search'), placeholder: t('searchPlaceholder') }}
            filters={filters}
            summary={t('showing', { shown: shown.length, total: apps.length })}
            clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: () => setStatus('all') }}
          />

          {shown.length === 0 ? (
            <EmptyState titleAs="p" title={t('noMatch')} action={!isDefault ? <Button onClick={reset}>{t('clear')}</Button> : undefined} />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable
                  label={title}
                  rows={shown}
                  columns={columns}
                  rowKey={(a) => a.id}
                  sort={{ column: sort.column, dir: sort.dir, onSort }}
                  onRowClick={(a) => setOpenId(a.id)}
                  minWidth="min-w-[52rem]"
                />
              </div>
              <ul aria-label={title} className="flex flex-col gap-3 md:hidden">
                {shown.map((a) => (
                  <ListRow key={a.id} onOpen={() => setOpenId(a.id)} menu={{ label: t('actionsFor', { app: a.name }), items: menuFor(a) }}>
                    <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{a.name}</span>
                    <span className="line-clamp-1 text-sm leading-5 break-all text-muted-foreground">{a.contactEmail ?? a.clientId}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Pill tone={APP_TONE[a.status] ?? 'muted'}>{t(`status.${a.status}` as 'status.approved')}</Pill>
                      <span className="text-sm leading-5 text-muted-foreground">{t('connectionsTitle', { count: a.connections.length })}</span>
                    </span>
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <SidePanel open={openApp !== null} title={openApp?.name ?? ''} closeLabel={t('detail.close')} onClose={() => setOpenId(null)}>
        {openApp ? <PartnerDetail app={openApp} /> : null}
      </SidePanel>

      <BottomSheet open={registering} title={t('registerTitle')} onClose={() => setRegistering(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void register()
          }}
        >
          <Field label={t('form.name')}>
            {(p) => <TextInput {...p} value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label={t('form.redirects')} hint={t('form.redirectsHelp')}>
            {(p) => (
              <TextArea
                {...p}
                rows={4}
                className="font-mono"
                value={form.redirectUris}
                required
                placeholder="https://partner.example/abluo/callback"
                onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.contact')}>
            {(p) => <TextInput {...p} type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />}
          </Field>
          <p className="text-sm text-muted-foreground">{t('form.pendingNote')}</p>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setRegistering(false)}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {t('register')}
            </Button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet open={revealed !== null} title={t('secret.title', { app: revealed?.appName ?? '' })} onClose={() => setRevealed(null)}>
        {revealed ? (
          <div className="space-y-4">
            <Notice tone="info">{t('secret.warning')}</Notice>
            {revealed.clientId ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-foreground">{t('facts.clientId')}</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2.5 text-sm break-all">{revealed.clientId}</code>
                  <Button onClick={() => copy(revealed.clientId!)}>{t('copy')}</Button>
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">{t('secret.label')}</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl border border-border px-3 py-2.5 text-sm break-all">{revealed.clientSecret}</code>
                <Button onClick={() => copy(revealed.clientSecret)}>{t('copy')}</Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setRevealed(null)}>
                {t('secret.done')}
              </Button>
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

/** The detail of one partner app (SidePanel body): its facts and every Connection. */
function PartnerDetail({ app: a }: { app: PartnerAppOverview }) {
  const t = useTranslations('admin.partners')
  return (
    <div className="space-y-5">
      <span className="block">
        <Pill tone={APP_TONE[a.status] ?? 'muted'}>{t(`status.${a.status}` as 'status.approved')}</Pill>
      </span>
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
    </div>
  )
}
