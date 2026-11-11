'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { bulkConversationsAction, type BulkConversationOp } from '@/app/[locale]/(admin)/messages/message-actions'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BarButton } from '@/components/app/ui/BarButton'
import { ButtonLink } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { SelectionBar } from '@/components/app/ui/SelectionBar'
import { Tabs } from '@/components/app/ui/Tabs'
import { ICONS as BAR_ICONS } from '@/components/client/posts/post-bits'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { TicketTime } from '@/components/client/tickets/ticket-bits'
import { DELETED_KEEP_DAYS, type ConversationSummary } from '@/lib/messages/model'

export type MessagesView = 'active' | 'archived' | 'deleted'

/**
 * Admin Messages (ADR-050) — a Records screen: every conversation (team inbox,
 * D1), filter by site and unread, search subject / people. "New Message" and
 * "Announcements" top right. Three views: active, archived (`?view=archived`),
 * Recently deleted (`?view=deleted`, 30 days).
 *
 * Status column: whether the client has seen Abluo's latest message — "Seen"
 * with the time, "Not seen yet", "Seen by n of m" for a shared one — or that
 * the client wrote last ("Replied", or "New reply" until Abluo opens it).
 *
 * Select several (checkboxes) to archive / restore them or delete them
 * (confirmation, then Recently deleted; "Delete Now" there is for good).
 */
export function AdminMessagesBrowser({ conversations, view }: { conversations: ConversationSummary[]; view: MessagesView }) {
  const t = useTranslations('admin.messages')
  const tc = useTranslations('app.messages')
  const router = useRouter()
  const archived = view === 'archived'
  const deleted = view === 'deleted'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'delete' | 'purge' | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [site, setSite] = useState('all')
  const [unread, setUnread] = useState<'all' | 'unread'>('all')
  const sites = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of conversations) if (c.project) map.set(c.project.id, c.project.name)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [conversations])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return conversations.filter(
      (c) =>
        (site === 'all' || c.project?.id === site) &&
        (unread === 'all' || c.unread) &&
        (!needle || `${c.subject} ${c.preview} ${c.participants.map((p) => `${p.name} ${p.email ?? ''}`).join(' ')}`.toLowerCase().includes(needle)),
    )
  }, [conversations, q, site, unread])
  const isDefault = !q && site === 'all' && unread === 'all'
  const selectedRows = shown.filter((c) => selected.has(c.id))
  const allState: 'none' | 'some' | 'all' = selectedRows.length === 0 ? 'none' : selectedRows.length === shown.length ? 'all' : 'some'
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const toggleAll = (on: boolean) => setSelected(on ? new Set(shown.map((c) => c.id)) : new Set())

  async function run(op: BulkConversationOp) {
    const ids = selectedRows.map((c) => c.id)
    if (!ids.length) return
    setBusy(true)
    setBulkError(null)
    const r = await bulkConversationsAction(ids, op).catch(() => ({ ok: false as const, reason: 'error' as const }))
    setBusy(false)
    if (r.ok) {
      setConfirm(null)
      setSelected(new Set())
      router.refresh()
    } else setBulkError(tc(`errors.${r.reason}`))
  }

  /** The status pill(s) of a row (point 5, Tom 2026-11-11). */
  const status = (c: ConversationSummary) => {
    const d = c.delivery
    const pills = []
    if (c.unread) pills.push(<Pill key="u" tone="highlight">{t('list.unread')}</Pill>)
    else if (d?.lastFrom === 'client') pills.push(<Pill key="r">{t('list.replied')}</Pill>)
    else if (d && d.total > 1) pills.push(<Pill key="s" tone={d.seen === d.total ? 'success' : 'muted'}>{t('list.seenBy', { seen: d.seen, total: d.total })}</Pill>)
    else if (d && d.seenAt)
      pills.push(
        <Pill key="s" tone="success">
          {t('list.seen')} · <TicketTime iso={d.seenAt} />
        </Pill>,
      )
    else if (d) pills.push(<Pill key="n">{t('list.notSeen')}</Pill>)
    if (c.mode === 'shared') pills.push(<Pill key="m">{t('list.shared', { count: c.participants.length })}</Pill>)
    return pills
  }
  const viewHref = (v: MessagesView) => (v === 'active' ? '/messages' : `/messages?view=${v}`)
  const hrefOf = (c: ConversationSummary) => `/messages/${c.id}`
  const who = (c: ConversationSummary) => c.participants.map((p) => p.name || p.email).filter(Boolean).join(', ')
  const chips: FilterChip[] = [
    ...(site !== 'all' ? [{ id: 'site', label: sites.find(([id]) => id === site)?.[1] ?? '' }] : []),
    ...(unread !== 'all' ? [{ id: 'unread', label: t('list.onlyUnread') }] : []),
  ]

  const columns: DataTableColumn<ConversationSummary>[] = [
    { key: 'subject', header: t('list.columns.subject'), width: 'min-w-64', render: (c) => <CellText primary={c.subject} secondary={c.preview || undefined} href={hrefOf(c)} clamp={2} /> },
    { key: 'people', header: t('list.columns.people'), width: 'min-w-48', render: (c) => <CellText primary={who(c)} secondary={c.project?.name} clamp={1} secondaryLines={1} /> },
    {
      key: 'state',
      header: t('list.columns.state'),
      width: 'w-52',
      render: (c) => <CellPill>{status(c)}</CellPill>,
    },
    { key: 'updated', header: t('list.columns.updated'), width: 'w-44', className: 'whitespace-nowrap', render: (c) => <TicketTime iso={c.lastActivityAt} className="text-sm leading-6 text-muted-foreground" /> },
  ]

  return (
    <>
      <PageHeader
        title={deleted ? t('deletedTitle') : archived ? t('archivedTitle') : t('title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink variant="secondary" href="/whats-new#announcements">
              {t('list.announcements')}
            </ButtonLink>
            <ButtonLink variant="primary" href="/messages/new">
              {t('list.newMessage')}
            </ButtonLink>
          </div>
        }
      />
      {/* The one Tabs component, as on Support Tickets (Tom, 2026-11-11): never a hand-made view switch. */}
      <Tabs label={t('list.views')} value={view} onChange={(v) => router.replace(viewHref(v as MessagesView))} items={(['active', 'archived', 'deleted'] as const).map((v) => ({ id: v, label: t(`list.view.${v}`) }))} />
      {deleted ? <Notice>{t('list.deletedNotice', { days: DELETED_KEEP_DAYS })}</Notice> : null}
      {conversations.length === 0 ? (
        <EmptyState
          title={deleted ? t('list.deletedEmptyTitle') : archived ? t('list.archivedEmptyTitle') : t('list.emptyTitle')}
          body={deleted ? t('list.deletedEmptyBody', { days: DELETED_KEEP_DAYS }) : archived ? t('list.archivedEmptyBody') : t('list.emptyBody')}
          action={
            archived || deleted ? undefined : (
              <ButtonLink variant="primary" href="/messages/new">
                {t('list.newMessage')}
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <ListToolbar
            label={t('list.filtersLabel')}
            search={{ value: q, onChange: setQ, label: t('list.searchLabel'), placeholder: t('list.search') }}
            filters={[
              {
                key: 'site',
                label: t('list.siteFilter'),
                value: site,
                options: [{ value: 'all', label: t('list.allSites') }, ...sites.map(([id, name]) => ({ value: id, label: name }))],
                onChange: setSite,
              },
              {
                key: 'unread',
                label: t('list.unreadFilter'),
                value: unread,
                options: [
                  { value: 'all', label: t('list.allConversations') },
                  { value: 'unread', label: t('list.onlyUnread') },
                ],
                onChange: (v) => setUnread(v as 'all' | 'unread'),
              },
            ]}
            summary={t('list.showing', { shown: shown.length, total: conversations.length })}
            clear={{
              label: t('list.clear'),
              onClear: () => {
                setQ('')
                setSite('all')
                setUnread('all')
              },
              visible: !isDefault,
            }}
            sheet={{
              activeCount: chips.length,
              resultCount: shown.length,
              chips,
              onRemoveChip: (id) => (id === 'site' ? setSite('all') : setUnread('all')),
            }}
          />
          {shown.length === 0 ? (
            <Notice>{t('list.noMatch')}</Notice>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable
                  rows={shown}
                  columns={columns}
                  rowKey={(c) => c.id}
                  rowHref={hrefOf}
                  label={t('title')}
                  minWidth="min-w-[56rem]"
                  selection={{ selected, onToggle: toggle, allState, onToggleAll: toggleAll, rowLabel: (c) => t('list.select', { subject: c.subject }), allLabel: t('list.selectAll') }}
                />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((c) => (
                  <ListRow key={c.id} href={hrefOf(c)} label={t('list.open', { subject: c.subject })}>
                    <span className="text-xs leading-5 font-medium text-muted-foreground">{c.project?.name}</span>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{c.subject}</span>
                    <span className="text-sm leading-5 text-muted-foreground">{who(c)}</span>
                    <span className="flex flex-wrap items-start gap-1.5">{status(c)}</span>
                    <TicketTime iso={c.lastActivityAt} className="text-xs leading-5 text-muted-foreground" />
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {selectedRows.length > 0 ? (
        <SelectionBar label={t('list.bulk.toolbar')} count={t('list.bulk.count', { count: selectedRows.length })}>
          {deleted ? (
            <>
              <BarButton disabled={busy} onPress={() => void run('restore')} icon={BAR_ICONS.restore}>
                {t('list.bulk.restore')}
              </BarButton>
              <BarButton destructive disabled={busy} onPress={() => setConfirm('purge')} icon={BAR_ICONS.trash}>
                {t('list.bulk.deleteNow')}
              </BarButton>
            </>
          ) : (
            <>
              <BarButton disabled={busy} onPress={() => void run(archived ? 'unarchive' : 'archive')} icon={archived ? BAR_ICONS.restore : BAR_ICONS.archiveAction}>
                {archived ? t('list.bulk.unarchive') : t('list.bulk.archive')}
              </BarButton>
              <BarButton destructive disabled={busy} onPress={() => setConfirm('delete')} icon={BAR_ICONS.trash}>
                {t('list.bulk.delete')}
              </BarButton>
            </>
          )}
          <BarButton onPress={() => setSelected(new Set())} icon={BAR_ICONS.x}>
            {t('list.bulk.cancel')}
          </BarButton>
        </SelectionBar>
      ) : null}
      {bulkError && !confirm ? <Notice tone="error">{bulkError}</Notice> : null}
      <ConfirmDialog
        open={confirm === 'delete'}
        title={t('list.bulk.deleteTitle', { count: selectedRows.length })}
        body={t('list.bulk.deleteBody', { count: selectedRows.length, days: DELETED_KEEP_DAYS })}
        confirmLabel={t('list.bulk.deleteConfirm', { count: selectedRows.length })}
        busy={busy}
        error={confirm === 'delete' ? bulkError : null}
        onConfirm={() => void run('delete')}
        onCancel={() => {
          setConfirm(null)
          setBulkError(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirm === 'purge'}
        titles={selectedRows.map((c) => c.subject)}
        busy={busy}
        error={confirm === 'purge' ? bulkError : null}
        onConfirm={() => void run('purge')}
        onCancel={() => {
          setConfirm(null)
          setBulkError(null)
        }}
      />
    </>
  )
}
