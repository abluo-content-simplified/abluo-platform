'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText } from '@/components/app/ui/list/cells'
import { TICKET_SEVERITIES, type TicketSummary } from '@/lib/support-tickets/model'
import {
  adminViewQuery,
  DEFAULT_ADMIN_VIEW,
  isDefaultAdminView,
  STATUS_FILTERS,
  type AdminTicketView,
} from '@/lib/support-tickets/admin-view'
import { AdminLastUpdate, SeverityPill, StatusPill } from './ticket-bits'

/** Lower-case, accent-free, so "citta" finds "Città". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Admin Support Tickets list (ADR-039) — a Records screen: ListToolbar, a
 * DataTable on computers and ListRows on phones. The filters live in the URL
 * (`?project=&status=&severity=`), so a filtered list can be shared and the
 * server does the filtering; the search box narrows what is shown. Sorted by
 * last activity, newest first. Opening a row goes to the ticket's own page.
 */
export function AdminTicketsBrowser({
  title,
  tickets,
  total,
  projects,
  view,
}: {
  title: string
  /** Already filtered by `view` and sorted by the server. */
  tickets: TicketSummary[]
  total: number
  projects: Array<{ slug: string; name: string }>
  view: AdminTicketView
}) {
  const t = useTranslations('admin.supportTickets')
  const router = useRouter()
  const [q, setQ] = useState('')

  const go = (patch: Partial<AdminTicketView>) => router.replace(`/support${adminViewQuery({ ...view, ...patch })}`)
  const terms = fold(q).split(/\s+/).filter(Boolean)
  const shown = terms.length
    ? tickets.filter((x) => {
        const hay = fold([x.reference, x.title, x.createdBy.name, x.createdBy.email ?? '', x.project?.name ?? ''].join(' '))
        return terms.every((term) => hay.includes(term))
      })
    : tickets
  const isDefault = isDefaultAdminView(view) && !q.trim()
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
  if (view.unread) chips.push({ id: 'unread', label: t('filters.unreadOnly') })
  if (view.seen) chips.push({ id: 'seen', label: t(view.seen === '0' ? 'filters.neverOpened' : 'filters.openedBefore') })
  const removeChip = (id: string) => go(id === 'project' ? { project: '' } : id === 'status' ? { status: 'active' } : id === 'unread' ? { unread: false } : id === 'seen' ? { seen: '' } : { severity: '' })

  const columns: DataTableColumn<TicketSummary>[] = [
    {
      key: 'reference',
      header: t('columns.reference'),
      width: 'w-40',
      render: (x) => (
        <span className="flex min-h-6 items-center gap-2 font-mono text-sm whitespace-nowrap text-foreground">
          <UnreadDot unread={x.unread} label={t('unread')} />
          {x.reference}
        </span>
      ),
    },
    { key: 'project', header: t('columns.project'), width: 'w-40', render: (x) => <CellText clamp={1} primary={x.project?.name || '—'} /> },
    {
      key: 'title',
      header: t('columns.title'),
      width: 'min-w-64',
      render: (x) => <CellText clamp={2} primary={x.title} href={`/support/${x.id}`} />,
    },
    {
      key: 'requester',
      header: t('columns.requester'),
      width: 'w-44',
      render: (x) => <span className="line-clamp-1 text-sm leading-6 text-foreground">{x.createdBy.name || x.createdBy.email || '—'}</span>,
    },
    { key: 'status', header: t('columns.status'), width: 'w-40', render: (x) => <CellPill><StatusPill status={x.status} /></CellPill> },
    { key: 'severity', header: t('columns.severity'), width: 'w-28', render: (x) => <CellPill>{x.severity ? <SeverityPill severity={x.severity} /> : null}</CellPill> },
    { key: 'activity', header: t('columns.activity'), width: 'w-44', render: (x) => <AdminLastUpdate iso={x.lastActivityAt} className="text-sm leading-6 whitespace-nowrap text-muted-foreground" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title={title} />

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
                <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">{x.createdBy.name || x.createdBy.email || '—'}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill status={x.status} />
                  {x.severity ? <SeverityPill severity={x.severity} /> : null}
                  <AdminLastUpdate iso={x.lastActivityAt} className="text-sm leading-5 text-muted-foreground" />
                </span>
              </ListRow>
            ))}
          </ul>
        </>
      )}
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
