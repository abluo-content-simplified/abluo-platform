'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ButtonLink, Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { TICKET_STATUSES, type TicketStatus, type TicketSummary } from '@/lib/support-tickets/model'
import { TicketStatusPill, TicketTime } from './ticket-bits'

/**
 * The client's Support list — a Records screen (ListToolbar + DataTable on
 * computers + ListRow on phones). Search by number or title, filter by status.
 * "New Request" is the primary action; without write access (or in support
 * mode) it is disabled and the reason is written under the header.
 */
export function SupportTicketsBrowser({
  tickets,
  projectSlug,
  canWrite,
  supportMode,
}: {
  tickets: TicketSummary[]
  projectSlug: string
  canWrite: boolean
  supportMode: boolean
}) {
  const t = useTranslations('clientDashboard.supportTickets')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | TicketStatus>('all')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tickets.filter((x) => (status === 'all' || x.status === status) && (!needle || `${x.reference} ${x.title}`.toLowerCase().includes(needle)))
  }, [tickets, q, status])
  const counts = useMemo(() => {
    const base = tickets.filter((x) => !q.trim() || `${x.reference} ${x.title}`.toLowerCase().includes(q.trim().toLowerCase()))
    return Object.fromEntries([['all', base.length], ...TICKET_STATUSES.map((s) => [s, base.filter((x) => x.status === s).length])]) as Record<'all' | TicketStatus, number>
  }, [tickets, q])
  const isDefault = !q && status === 'all'
  const reset = () => {
    setQ('')
    setStatus('all')
  }
  const hrefOf = (x: TicketSummary) => `/${projectSlug}/support/${x.id}`
  const newHref = `/${projectSlug}/support/new`
  const reason = supportMode ? t('list.supportMode') : !canWrite ? t('list.cannotWrite') : null

  const chips: FilterChip[] = status !== 'all' ? [{ id: 'status', label: t(`status.${status}`) }] : []

  const columns: DataTableColumn<TicketSummary>[] = [
    { key: 'reference', header: t('list.columns.reference'), width: 'w-36', className: 'whitespace-nowrap', render: (x) => <CellText primary={x.reference} href={hrefOf(x)} clamp={1} /> },
    { key: 'title', header: t('list.columns.title'), width: 'min-w-64', render: (x) => <CellText primary={x.title} clamp={2} /> },
    {
      key: 'status',
      header: t('list.columns.status'),
      width: 'w-48',
      render: (x) => (
        <CellPill>
          <TicketStatusPill status={x.status} />
          {x.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
        </CellPill>
      ),
    },
    { key: 'updated', header: t('list.columns.updated'), width: 'w-52', className: 'whitespace-nowrap', render: (x) => <TicketTime iso={x.lastActivityAt} className="text-sm leading-6 text-muted-foreground" /> },
  ]

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          reason ? (
            <Button variant="primary" disabled aria-describedby="new-request-reason">
              {t('list.newRequest')}
            </Button>
          ) : (
            <ButtonLink variant="primary" href={newHref}>
              {t('list.newRequest')}
            </ButtonLink>
          )
        }
      />
      {reason ? (
        <p id="new-request-reason" className="text-sm leading-5 text-muted-foreground">
          {reason}
        </p>
      ) : null}

      {tickets.length === 0 ? (
        <EmptyState
          title={t('list.emptyTitle')}
          body={t('list.emptyBody')}
          action={
            reason ? undefined : (
              <ButtonLink variant="primary" href={newHref}>
                {t('list.newRequest')}
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
                key: 'status',
                label: t('list.statusFilter'),
                value: status,
                options: [
                  { value: 'all', label: `${t('list.allStatuses')} (${counts.all})` },
                  // "Waiting for You" first: it is the one that needs the person.
                  ...[...TICKET_STATUSES].sort((a, b) => Number(b === 'waiting_for_user') - Number(a === 'waiting_for_user')).map((s) => ({ value: s, label: `${t(`status.${s}`)} (${counts[s]})` })),
                ],
                onChange: (v) => setStatus(v as 'all' | TicketStatus),
              },
            ]}
            summary={t('list.showing', { shown: shown.length, total: tickets.length })}
            clear={{ label: t('list.clear'), onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: () => setStatus('all') }}
          />
          {shown.length === 0 ? (
            <Notice>{t('list.noMatch')}</Notice>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable rows={shown} columns={columns} rowKey={(x) => x.id} rowHref={hrefOf} label={t('title')} minWidth="min-w-[48rem]" />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((x) => (
                  <ListRow key={x.id} href={hrefOf(x)} label={t('list.open', { reference: x.reference, title: x.title })}>
                    <span className="text-xs leading-5 font-medium text-muted-foreground">{x.reference}</span>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{x.title}</span>
                    <span className="flex flex-wrap items-start gap-1.5">
                      <TicketStatusPill status={x.status} />
                      {x.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
                    </span>
                    <TicketTime iso={x.lastActivityAt} className="text-xs leading-5 text-muted-foreground" />
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  )
}
