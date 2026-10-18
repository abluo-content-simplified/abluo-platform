'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { EventListItem } from '@/lib/api/event-drafts'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellDate, CellImage, CellText, MediaFrame } from '@/components/app/ui/list/cells'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { searchText as searchable } from '@/lib/client/search-text'
import { EVENT_ICONS, EventStatePill, eventState, type EventState, useEventDates } from './event-bits'

type When = 'upcoming' | 'past' | 'all'
type SortKey = 'title' | 'when' | 'updated'
const VIEWS = ['list', 'cards'] as const
type Status = EventState | 'all'

/**
 * Events (client dashboard · agenda) — a "content" list screen like Posts:
 * the shared toolbar (search, when, status — "Coming up" by default), then on
 * computers a table or cards (the view switch, list first, remembered per
 * person) and on phones one row per event: photo, title, when, where and its
 * state. "New event" when this person can write events.
 */
export function EventList({ projectSlug, events, canWrite }: { projectSlug: string; events: EventListItem[]; canWrite: boolean }) {
  const t = useTranslations('clientDashboard.events.list')
  const ts = useTranslations('clientDashboard.events.state')
  const dates = useEventDates()
  const base = `/${projectSlug}/agenda`
  const [query, setQuery] = useState('')
  const [when, setWhen] = useState<When>('upcoming')
  const [status, setStatus] = useState<Status>('all')
  const [view, setView] = useViewPreference<'list' | 'cards'>('events.view', VIEWS, 'list')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'when', dir: 'asc' })

  const q = searchable(query.trim())
  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (when === 'all' || (when === 'past' ? e.timing === 'past' : e.timing !== 'past')) &&
          (status === 'all' || eventState(e) === status) &&
          (!q || searchable(`${e.title} ${e.location ?? ''}`).includes(q))
      ),
    [events, when, status, q]
  )
  const sorted = useMemo(() => {
    const value = (e: EventListItem) => (sort.key === 'title' ? (e.title || '').toLocaleLowerCase() : sort.key === 'updated' ? e.updatedAt : (e.startDate ?? ''))
    const out = [...shown].sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0))
    return sort.dir === 'asc' ? out : out.reverse()
  }, [shown, sort])
  const onSort = (key: string) => setSort((s) => (s.key === key ? { key: s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: key as SortKey, dir: key === 'updated' ? 'desc' : 'asc' }))
  const isDefault = !query.trim() && when === 'upcoming' && status === 'all'
  const reset = () => {
    setQuery('')
    setWhen('upcoming')
    setStatus('all')
  }

  const whenOptions = (['upcoming', 'past', 'all'] as const).map((v) => ({ value: v, label: t(`filters.when${v[0].toUpperCase()}${v.slice(1)}` as 'filters.whenUpcoming') }))
  const statusOptions = [{ value: 'all', label: t('filters.statusAll') }, ...(['live', 'changes', 'draft'] as const).map((v) => ({ value: v, label: ts(v) }))]
  const filters: ListToolbarFilter[] = [
    { key: 'when', label: t('filters.when'), value: when, options: whenOptions, onChange: (v) => setWhen(v as When) },
    { key: 'status', label: t('filters.status'), value: status, options: statusOptions, onChange: (v) => setStatus(v as Status) },
  ]
  const chips: FilterChip[] = [
    ...(when !== 'upcoming' ? [{ id: 'when', label: whenOptions.find((o) => o.value === when)!.label }] : []),
    ...(status !== 'all' ? [{ id: 'status', label: statusOptions.find((o) => o.value === status)!.label }] : []),
  ]

  const newButton = canWrite ? (
    <ButtonLink variant="primary" href={`${base}/new`}>
      {EVENT_ICONS.plus}
      {t('new')}
    </ButtonLink>
  ) : null
  const headerActions = (
    <>
      {events.length > 0 ? (
        <span className="hidden md:inline-flex">
          <ViewSwitch
            label={t('view.label')}
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: t('view.list'), icon: EVENT_ICONS.list },
              { value: 'cards', label: t('view.cards'), icon: EVENT_ICONS.cards },
            ]}
          />
        </span>
      ) : null}
      {newButton}
    </>
  )
  const hrefOf = (e: EventListItem) => `${base}/${e.id}`
  const columns: DataTableColumn<EventListItem>[] = [
    {
      key: 'title',
      header: t('columns.event'),
      sortable: true,
      width: 'min-w-64',
      render: (e) => (
        <div className="flex items-start gap-3">
          <CellImage src={e.coverThumb} alt="" />
          <CellText primary={e.title || t('untitled')} href={hrefOf(e)} />
        </div>
      ),
    },
    { key: 'when', header: t('columns.when'), sortable: true, width: 'w-64', render: (e) => <span className="flex min-h-6 items-center text-sm leading-6 text-foreground">{dates(e.startDate, e.endDate) || '—'}</span> },
    { key: 'where', header: t('columns.where'), width: 'w-48', render: (e) => <span className="line-clamp-2 text-sm leading-6 text-muted-foreground">{e.location || '—'}</span> },
    { key: 'status', header: t('columns.status'), width: 'w-44', render: (e) => <EventStatePill state={eventState(e)} /> },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-32', render: (e) => <CellDate iso={e.updatedAt} /> },
  ]

  const detail = (e: EventListItem) => {
    const when = dates(e.startDate, e.endDate)
    return [when, e.location].filter(Boolean).join(' · ')
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={headerActions} />
      <p className="-mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>

      {events.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={newButton} />
      ) : (
        <>
          <ListToolbar
            label={t('filters.label')}
            search={{ value: query, onChange: setQuery, placeholder: t('filters.search'), label: t('filters.search') }}
            filters={filters}
            summary={t('count', { shown: shown.length, total: events.length })}
            clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
            sheet={{
              activeCount: chips.length,
              resultCount: shown.length,
              chips,
              onRemoveChip: (id) => (id === 'when' ? setWhen('upcoming') : setStatus('all')),
            }}
          />

          {shown.length === 0 ? (
            isDefault ? (
              <EmptyState titleAs="p" title={t('noUpcoming')} action={<Button onClick={() => setWhen('past')}>{t('showPast')}</Button>} />
            ) : (
              <EmptyState titleAs="p" title={t('noMatch')} action={<Button onClick={reset}>{t('clear')}</Button>} />
            )
          ) : (
            <>
              {/* Computers: a table or cards. */}
              <div className="hidden md:block">
                {view === 'list' ? (
                  <DataTable label={t('title')} rows={sorted} columns={columns} rowKey={(e) => e.id} rowHref={hrefOf} sort={{ column: sort.key, dir: sort.dir, onSort }} minWidth="min-w-[56rem]" />
                ) : (
                <CardGrid label={t('title')}>
                  {sorted.map((e) => (
                    <CardGridItem key={e.id}>
                      <ContentCard media={{ src: e.coverThumb }} title={e.title || t('untitled')} subtitle={detail(e)} href={`${base}/${e.id}`}>
                        <EventStatePill state={eventState(e)} />
                      </ContentCard>
                    </CardGridItem>
                  ))}
                </CardGrid>
                )}
              </div>
              {/* Phones: rows. */}
              <ul className="flex flex-col gap-3 md:hidden" aria-label={t('title')}>
                {sorted.map((e) => (
                  <ListRow key={e.id} href={`${base}/${e.id}`} leading={<MediaFrame src={e.coverThumb} alt="" size={{ width: '4.5rem', height: '4.5rem' }} className="shrink-0 rounded-lg" />}>
                    <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{e.title || t('untitled')}</span>
                    {detail(e) ? <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{detail(e)}</span> : null}
                    <EventStatePill state={eventState(e)} />
                  </ListRow>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
