'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ButtonLink } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { TicketTime } from '@/components/client/tickets/ticket-bits'
import type { ConversationSummary } from '@/lib/messages/model'

/**
 * Admin Messages (ADR-050) — a Records screen: every conversation (team inbox,
 * D1), filter by site and unread, search subject / people. "New Message" top
 * right. Archived conversations are a separate view (`?view=archived`).
 */
export function AdminMessagesBrowser({ conversations, archived }: { conversations: ConversationSummary[]; archived: boolean }) {
  const t = useTranslations('admin.messages')
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
  const hrefOf = (c: ConversationSummary) => `/messages/${c.id}`
  const who = (c: ConversationSummary) => c.participants.map((p) => p.name || p.email).filter(Boolean).join(', ')
  const chips: FilterChip[] = [
    ...(site !== 'all' ? [{ id: 'site', label: sites.find(([id]) => id === site)?.[1] ?? '' }] : []),
    ...(unread !== 'all' ? [{ id: 'unread', label: t('list.onlyUnread') }] : []),
  ]

  const columns: DataTableColumn<ConversationSummary>[] = [
    { key: 'subject', header: t('list.columns.subject'), width: 'min-w-64', render: (c) => <CellText primary={c.subject} secondary={c.preview || undefined} href={hrefOf(c)} clamp={2} /> },
    { key: 'people', header: t('list.columns.people'), width: 'min-w-48', render: (c) => <CellText primary={who(c)} secondary={c.project?.name} clamp={2} /> },
    {
      key: 'state',
      header: t('list.columns.state'),
      width: 'w-44',
      render: (c) => (
        <CellPill>
          {c.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
          {c.mode === 'shared' ? <Pill>{t('list.shared', { count: c.participants.length })}</Pill> : null}
        </CellPill>
      ),
    },
    { key: 'updated', header: t('list.columns.updated'), width: 'w-44', className: 'whitespace-nowrap', render: (c) => <TicketTime iso={c.lastActivityAt} className="text-sm leading-6 text-muted-foreground" /> },
  ]

  return (
    <>
      <PageHeader
        title={archived ? t('archivedTitle') : t('title')}
        actions={
          <ButtonLink variant="primary" href="/messages/new">
            {t('list.newMessage')}
          </ButtonLink>
        }
      />
      <div className="flex flex-wrap items-start gap-2">
        <ButtonLink variant="link" href={archived ? '/messages' : '/messages?view=archived'}>
          {archived ? t('list.showActive') : t('list.showArchived')}
        </ButtonLink>
      </div>
      {conversations.length === 0 ? (
        <EmptyState
          title={archived ? t('list.archivedEmptyTitle') : t('list.emptyTitle')}
          body={archived ? t('list.archivedEmptyBody') : t('list.emptyBody')}
          action={
            archived ? undefined : (
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
                <DataTable rows={shown} columns={columns} rowKey={(c) => c.id} rowHref={hrefOf} label={t('title')} minWidth="min-w-[52rem]" />
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {shown.map((c) => (
                  <ListRow key={c.id} href={hrefOf(c)} label={t('list.open', { subject: c.subject })}>
                    <span className="text-xs leading-5 font-medium text-muted-foreground">{c.project?.name}</span>
                    <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{c.subject}</span>
                    <span className="text-sm leading-5 text-muted-foreground">{who(c)}</span>
                    {c.unread || c.mode === 'shared' ? (
                      <span className="flex flex-wrap items-start gap-1.5">
                        {c.unread ? <Pill tone="highlight">{t('list.unread')}</Pill> : null}
                        {c.mode === 'shared' ? <Pill>{t('list.shared', { count: c.participants.length })}</Pill> : null}
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
