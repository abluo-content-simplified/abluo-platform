'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { bulkTicketsAction } from '@/app/[locale]/(admin)/support/ticket-actions'
import { BarButton, SheetItem } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { SelectionBar } from '@/components/app/ui/SelectionBar'
import { Tabs } from '@/components/app/ui/Tabs'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { ICONS as BAR_ICONS } from '@/components/client/posts/post-bits'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { timeAgo } from '@/lib/client/home-cards'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { TICKET_SEVERITIES, TICKET_STATUSES, type TicketSeverity, type TicketStatus, type TicketSummary } from '@/lib/support-tickets/model'
import {
  activeQuickView,
  adminViewQuery,
  DEFAULT_ADMIN_VIEW,
  effectiveSort,
  isDefaultAdminView,
  nextSort,
  NEXT_FILTERS,
  QUICK_VIEWS,
  quickViewFilters,
  STATUS_FILTERS,
  type AdminTicketView,
  type QuickView,
  type SortKey,
} from '@/lib/support-tickets/admin-view'
import { AdminLastUpdate, SeverityPill, StatusPill } from './ticket-bits'

/** Lower-case, accent-free, so "citta" finds "Città". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Admin Support Tickets list (ADR-039) — a Records screen: ListToolbar, a
 * DataTable on computers and ListRows on phones. The filters live in the URL
 * (`?project=&status=&severity=`), so a filtered list can be shared and the
 * server does the filtering; the search box narrows what is shown. Opening a
 * row goes to the ticket's own page.
 *
 * Day to day (Tom, 2026-11-11): quick views on top (Needs Reply · Waiting for
 * Client · All Open · Closed, with counts); a "Next step" column worked out
 * from the latest message — "Your turn" or "Waiting for Claudia", with since
 * when — and "Last activity" saying who wrote last ("Claudia · CYCE",
 * "Tom · Abluo", "Read" once the client opened Abluo's answer). Both can be
 * filtered and sorted; column headers sort, the order lives in the URL.
 */
export function AdminTicketsBrowser({
  title,
  tickets,
  total,
  projects,
  view,
  counts,
}: {
  title: string
  /** Already filtered by `view` and sorted by the server. */
  tickets: TicketSummary[]
  total: number
  projects: Array<{ slug: string; name: string }>
  view: AdminTicketView
  /** Quick-view counts (on the chosen project). */
  counts: Record<QuickView, number>
}) {
  const t = useTranslations('admin.supportTickets')
  const router = useRouter()
  const dateLocale = useDateLocale()
  const sort = effectiveSort(view)
  const quick = activeQuickView(view)
  const ago = (iso: string) => timeAgo(iso, dateLocale)
  const [q, setQ] = useState('')
  const { toast, show } = useUndo()
  // Bulk (Tom, 2026-11-11): tick tickets, then set their status or severity in one go.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<'status' | 'severity' | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const go = (patch: Partial<AdminTicketView>) => router.replace(`/support${adminViewQuery({ ...view, ...patch })}`)
  const terms = fold(q).split(/\s+/).filter(Boolean)
  const shown = terms.length
    ? tickets.filter((x) => {
        const hay = fold([x.reference, x.title, x.createdBy.name, x.createdBy.email ?? '', x.project?.name ?? ''].join(' '))
        return terms.every((term) => hay.includes(term))
      })
    : tickets
  const isDefault = isDefaultAdminView(view) && !q.trim()
  const selectedRows = shown.filter((x) => selected.has(x.id))
  const allState: 'none' | 'some' | 'all' = selectedRows.length === 0 ? 'none' : selectedRows.length === shown.length ? 'all' : 'some'
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  async function bulk(field: 'status' | 'severity', value: TicketStatus | TicketSeverity) {
    // Only the tickets that actually change.
    const ids = selectedRows.filter((x) => (field === 'status' ? x.status !== value : (x.severity ?? 'normal') !== value)).map((x) => x.id)
    setSheet(null)
    if (!ids.length) return
    setBusy(true)
    setBulkError(null)
    try {
      const r = await bulkTicketsAction(ids, field, value)
      if (r.ok) {
        show({ message: t('bulk.done', { count: r.changed }), tone: 'status' })
        setSelected(new Set())
      } else setBulkError(t('bulk.partly', { changed: r.changed, total: ids.length }))
      router.refresh()
    } catch {
      setBulkError(t('errors.error'))
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setQ('')
    if (!isDefaultAdminView(view)) router.replace('/support')
  }

  const filters: ListToolbarFilter[] = [
    {
      key: 'project',
      label: t('filters.project'),
      value: view.project,
      options: [{ value: '', label: t('filters.allProjects') }, ...projects.map((p) => ({ value: p.slug, label: p.name }))],
      onChange: (project) => go({ project }),
    },
    {
      key: 'status',
      label: t('filters.status'),
      value: view.status,
      options: STATUS_FILTERS.map((s) => ({ value: s, label: s === 'active' || s === 'all' ? t(`statusFilters.${s}`) : t(`status.${s}`) })),
      onChange: (status) => go({ status: status as AdminTicketView['status'] }),
    },
    {
      key: 'next',
      label: t('next.filter'),
      value: view.next,
      options: NEXT_FILTERS.map((n) => ({ value: n, label: n ? t(`next.filters.${n}`) : t('next.filters.any') })),
      onChange: (next) => go({ next: next as AdminTicketView['next'], sort: null }),
    },
    {
      key: 'severity',
      label: t('filters.severity'),
      value: view.severity,
      options: [{ value: '', label: t('filters.allSeverities') }, ...TICKET_SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) }))],
      onChange: (severity) => go({ severity: severity as AdminTicketView['severity'] }),
    },
  ]
  const chips: FilterChip[] = []
  if (view.project) chips.push({ id: 'project', label: projects.find((p) => p.slug === view.project)?.name ?? view.project })
  if (view.status !== DEFAULT_ADMIN_VIEW.status) chips.push({ id: 'status', label: view.status === 'all' ? t('statusFilters.all') : t(`status.${view.status}`) })
  if (view.severity) chips.push({ id: 'severity', label: t(`severity.${view.severity}`) })
  if (view.next) chips.push({ id: 'next', label: t(`next.filters.${view.next}`) })
  if (view.unread) chips.push({ id: 'unread', label: t('filters.unreadOnly') })
  if (view.seen) chips.push({ id: 'seen', label: t(view.seen === '0' ? 'filters.neverOpened' : 'filters.openedBefore') })
  const removeChip = (id: string) =>
    go(id === 'project' ? { project: '' } : id === 'status' ? { status: 'active' } : id === 'unread' ? { unread: false } : id === 'seen' ? { seen: '' } : id === 'next' ? { next: '', sort: null } : { severity: '' })

  /** "Your turn" / "Waiting for Claudia", and since when. */
  const nextCell = (x: TicketSummary) => {
    const n = x.next
    if (!n || n.kind === 'done') return <span className="text-sm leading-6 text-muted-foreground">—</span>
    return (
      <span className="flex flex-col items-start gap-1">
        {n.kind === 'yourTurn' ? (
          <Pill tone="highlight">{t('next.yourTurn')}</Pill>
        ) : (
          <Pill>
            {/* A long full name stays on one line; the whole name is in the tooltip. */}
            <span className="block max-w-[11rem] truncate" title={n.on || undefined}>
              {n.on ? t('next.waitingFor', { name: n.on }) : t('next.waitingForClient')}
            </span>
          </Pill>
        )}
        <span className="text-sm leading-5 text-muted-foreground" suppressHydrationWarning>
          {ago(n.since)}
        </span>
      </span>
    )
  }
  /** Who wrote last, when, and whether the client has read Abluo's answer. */
  const lastCell = (x: TicketSummary, compact = false) => {
    const m = x.lastMessage
    const who = !m
      ? x.createdBy.name || x.createdBy.email || '—'
      : m.by === 'support'
        ? t('lastBy.support', { name: m.name || t('lastBy.someone') })
        : x.project?.name
          ? t('lastBy.client', { name: m.name || t('lastBy.someone'), project: x.project.name })
          : m.name || '—'
    const read = m?.by === 'support' && x.clientReadAt && x.clientReadAt >= m.at
    return (
      <span className={`flex min-w-0 ${compact ? 'flex-wrap items-center gap-x-2' : 'flex-col'} text-sm leading-5`}>
        <span className="line-clamp-1 text-foreground" title={who}>
          {who}
        </span>
        <span className="text-muted-foreground">
          <AdminLastUpdate iso={x.lastActivityAt} />
          {read ? ` · ${t('lastBy.read')}` : null}
        </span>
      </span>
    )
  }
  const onSort = (key: string) => go({ sort: nextSort(sort, key as SortKey) })

  const columns: DataTableColumn<TicketSummary>[] = [
    {
      key: 'reference',
      header: t('columns.reference'),
      width: 'w-36',
      sortable: true,
      render: (x) => (
        <span className="flex min-h-6 items-center gap-2 font-mono text-sm whitespace-nowrap text-foreground">
          <UnreadDot unread={x.unread} label={t('unread')} />
          {x.reference}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('columns.title'),
      width: 'min-w-64',
      render: (x) => <CellText clamp={2} primary={x.title} secondary={[x.project?.name, x.createdBy.name || x.createdBy.email].filter(Boolean).join(' · ') || undefined} secondaryLines={1} href={`/support/${x.id}`} />,
    },
    { key: 'next', header: t('next.column'), width: 'w-48', sortable: true, render: nextCell },
    { key: 'activity', header: t('columns.activity'), width: 'w-52', sortable: true, render: (x) => lastCell(x) },
    { key: 'status', header: t('columns.status'), width: 'w-40', sortable: true, render: (x) => <CellPill><StatusPill status={x.status} /></CellPill> },
    { key: 'severity', header: t('columns.severity'), width: 'w-28', sortable: true, render: (x) => <CellPill>{x.severity ? <SeverityPill severity={x.severity} /> : null}</CellPill> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={title} />

      <Tabs
        label={t('quick.label')}
        value={quick ?? ''}
        onChange={(q) => go(quickViewFilters(q as QuickView))}
        items={QUICK_VIEWS.map((q) => ({ id: q, label: t(`quick.${q}`), count: counts[q] }))}
      />

      <ListToolbar
        label={t('filters.label')}
        search={{ value: q, onChange: setQ, label: t('search'), placeholder: t('searchPlaceholder') }}
        filters={filters}
        summary={t('showing', { shown: shown.length, total })}
        clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: removeChip }}
      />

      {shown.length === 0 ? (
        <EmptyState
          titleAs="p"
          title={total === 0 && isDefaultAdminView(view) ? t('emptyTitle') : t('noMatch')}
          body={total === 0 && isDefaultAdminView(view) ? t('emptyBody') : undefined}
          action={!isDefault ? <Button onClick={reset}>{t('clear')}</Button> : undefined}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              label={title}
              rows={shown}
              columns={columns}
              rowKey={(x) => x.id}
              rowHref={(x) => `/support/${x.id}`}
              minWidth="min-w-[62rem]"
              sort={{ column: sort.key, dir: sort.dir, onSort }}
              selection={{
                selected,
                onToggle: (id, on) => toggle(id, on),
                allState,
                onToggleAll: (on) => setSelected(on ? new Set(shown.map((x) => x.id)) : new Set()),
                rowLabel: (x) => t('bulk.select', { reference: x.reference }),
                allLabel: t('bulk.selectAll'),
              }}
            />
          </div>
          <ul aria-label={title} className="flex flex-col gap-3 md:hidden">
            {shown.map((x) => (
              <ListRow key={x.id} href={`/support/${x.id}`}>
                <span className="flex items-center gap-2 font-mono text-xs leading-5 text-muted-foreground">
                  <UnreadDot unread={x.unread} label={t('unread')} />
                  {x.reference}
                  {x.project?.name ? <span className="font-sans">· {x.project.name}</span> : null}
                </span>
                <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{x.title}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {x.next && x.next.kind !== 'done' ? (
                    x.next.kind === 'yourTurn' ? (
                      <Pill tone="highlight">{t('next.yourTurn')}</Pill>
                    ) : (
                      <Pill>{x.next.on ? t('next.waitingFor', { name: x.next.on }) : t('next.waitingForClient')}</Pill>
                    )
                  ) : null}
                  <StatusPill status={x.status} />
                  {x.severity ? <SeverityPill severity={x.severity} /> : null}
                </span>
                {lastCell(x, true)}
              </ListRow>
            ))}
          </ul>
        </>
      )}
      {bulkError ? <Notice tone="error">{bulkError}</Notice> : null}
      {selectedRows.length > 0 ? (
        <SelectionBar label={t('bulk.toolbar')} count={t('bulk.count', { count: selectedRows.length })}>
          <BarButton disabled={busy} onPress={() => setSheet('status')} icon={BAR_ICONS.tick}>
            {t('bulk.status')}
          </BarButton>
          <BarButton disabled={busy} onPress={() => setSheet('severity')} icon={BAR_ICONS.warn}>
            {t('bulk.severity')}
          </BarButton>
          <BarButton onPress={() => setSelected(new Set())} icon={BAR_ICONS.x}>
            {t('bulk.cancel')}
          </BarButton>
        </SelectionBar>
      ) : null}
      <BottomSheet open={sheet === 'status'} title={t('bulk.statusTitle', { count: selectedRows.length })} onClose={() => setSheet(null)}>
        <div className="mt-2 flex flex-col">
          {TICKET_STATUSES.map((st) => (
            <SheetItem key={st} onPress={() => void bulk('status', st)}>
              <StatusPill status={st} />
            </SheetItem>
          ))}
        </div>
      </BottomSheet>
      <BottomSheet open={sheet === 'severity'} title={t('bulk.severityTitle', { count: selectedRows.length })} onClose={() => setSheet(null)}>
        <div className="mt-2 flex flex-col">
          {TICKET_SEVERITIES.map((sv) => (
            <SheetItem key={sv} onPress={() => void bulk('severity', sv)}>
              <SeverityPill severity={sv} />
            </SheetItem>
          ))}
        </div>
      </BottomSheet>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

function UnreadDot({ unread, label }: { unread: boolean; label: string }) {
  if (!unread) return <span aria-hidden="true" className="size-2 shrink-0" />
  return (
    <>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-foreground" />
      <span className="sr-only">{label}</span>
    </>
  )
}
