'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { TicketTime } from '@/components/client/tickets/ticket-bits'
import type { ConversationSummary } from '@/lib/messages/model'

/**
 * The client's Messages list (ADR-050 D12) — a Records screen: ListToolbar +
 * DataTable on computers, ListRow on phones, no cards. Only Abluo starts a
 * conversation (D1), so there is no "New" button; problems go to Support.
 */
export function MessagesBrowser({ conversations, projectSlug }: { conversations: ConversationSummary[]; projectSlug: string }) {
  const t = useTranslations('clientDashboard.messages')
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return conversations.filter((c) => !needle || `${c.subject} ${c.preview}`.toLowerCase().includes(needle))
  }, [conversations, q])
  const hrefOf = (c: ConversationSummary) => `/${projectSlug}/messages/${c.id}`
  const shared = (c: ConversationSummary) => (c.mode === 'shared' ? <Pill>{t('list.shared', { count: c.participants.length })}</Pill> : null)

  const columns: DataTableColumn<ConversationSummary>[] = [
    { key: 'subject', header: t('list.columns.subject'), width: 'min-w-64', render: (c) => <CellText primary={c.subject} secondary={c.preview || undefined} href={hrefOf(c)} clamp={2} /> },
    {
      key: 'state',
      header: t('list.columns.state'),
      width: 'w-48',
      render: (c) => (
        <CellPill>
          {c.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
          {shared(c)}
        </CellPill>
      ),
    },
    { key: 'updated', header: t('list.columns.updated'), width: 'w-52', className: 'whitespace-nowrap', render: (c) => <TicketTime iso={c.lastActivityAt} className="text-sm leading-6 text-muted-foreground" /> },
  ]

  return (
    <>
      <PageHeader title={t('title')} />
      <p className="text-sm leading-5 text-muted-foreground">{t('intro')}</p>
      {conversations.length === 0 ? (
        <EmptyState title={t('list.emptyTitle')} body={t('list.emptyBody')} />
      ) : (
        <>
          <ListToolbar
            label={t('list.filtersLabel')}
            search={{ value: q, onChange: setQ, label: t('list.searchLabel'), placeholder: t('list.search') }}
            summary={t('list.showing', { shown: shown.length, total: conversations.length })}
            clear={{ label: t('list.clear'), onClear: () => setQ(''), visible: q !== '' }}
            sheet={{ activeCount: 0, resultCount: shown.length, chips: [], onRemoveChip: () => {} }}
          />
          {shown.length === 0 ? (
            <Notice>{t('list.noMatch')}</Notice>
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable rows={shown} columns={columns} rowKey={(c) => c.id} rowHref={hrefOf} label={t('title')} minWidth="min-w-[44rem]" />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((c) => (
                  <ListRow key={c.id} href={hrefOf(c)} label={t('list.open', { subject: c.subject })}>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{c.subject}</span>
                    {c.preview ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{c.preview}</span> : null}
                    {c.unread || c.mode === 'shared' ? (
                      <span className="flex flex-wrap items-start gap-1.5">
                        {c.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
                        {shared(c)}
                      </span>
                    ) : null}
                    <TicketTime iso={c.lastActivityAt} className="text-xs leading-5 text-muted-foreground" />
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
