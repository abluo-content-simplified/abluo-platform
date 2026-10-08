'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { CellText, Pill, type PillTone } from '@/components/app/ui/list/cells'
import { Sparkline } from '@/components/app/ui/Sparkline'
import {
  applyPortfolioFilters,
  CONNECTION_FILTERS,
  connectionOf,
  DEFAULT_PORTFOLIO_FILTERS,
  isDefaultPortfolioFilters,
  nextPortfolioSort,
  STATUS_FILTERS,
  type PortfolioFilters,
  type SortColumn,
} from '@/lib/analytics/portfolio-filter'
import type { DataStatus, PortfolioRow } from '@/lib/analytics/view'

/**
 * Admin → Analytics: one row per site (ADR-030 §5.2). Desktop: a sortable
 * DataTable; phones: cards. Search + status + connection filters. A row opens
 * `/analytics/{slug}`, the same widgets the client sees. Copy: admin.analytics.
 */

const STATUS_TONE: Record<DataStatus, PillTone> = { connected: 'success', stale: 'highlight', error: 'outline', not_connected: 'muted' }

export function StatusPill({ status }: { status: DataStatus }) {
  const t = useTranslations('admin.analytics.status')
  return (
    <Pill
      tone={STATUS_TONE[status]}
      icon={<span aria-hidden="true" className={`size-1.5 rounded-full ${status === 'error' ? 'bg-destructive' : status === 'connected' ? 'bg-success' : 'bg-muted-foreground'}`} />}
    >
      {t(status)}
    </Pill>
  )
}

export function TrendText({ percent }: { percent: number | null }) {
  const t = useTranslations('admin.analytics')
  if (percent === null) return <span className="text-muted-foreground">—</span>
  const tone = percent > 0 ? 'text-success' : percent < 0 ? 'text-destructive' : 'text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${tone}`}>
      {percent !== 0 ? (
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 fill-current">
          {percent > 0 ? <path d="M6 2 11 10H1z" /> : <path d="M6 10 1 2h10z" />}
        </svg>
      ) : null}
      {t(percent > 0 ? 'trendUp' : percent < 0 ? 'trendDown' : 'trendFlat', { percent: Math.abs(percent) })}
    </span>
  )
}

export function PortfolioBrowser({ rows }: { rows: PortfolioRow[] }) {
  const t = useTranslations('admin.analytics')
  const ta = useTranslations('app.analytics')
  const format = useFormatter()
  const [filters, setFilters] = useState<PortfolioFilters>(DEFAULT_PORTFOLIO_FILTERS)
  const update = (patch: Partial<PortfolioFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_PORTFOLIO_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyPortfolioFilters(rows, filters), [rows, filters])
  const href = (r: PortfolioRow) => `/analytics/${r.slug}`
  const n = (v: number | null) => (v === null ? '—' : format.number(v))
  const channel = (v: string | null) => {
    if (!v) return '—'
    const key = v.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    return ta.has(`channels.${key}`) ? ta(`channels.${key}` as 'channels.direct') : v
  }

  const count = (key: 'status' | 'connection', value: string) => applyPortfolioFilters(rows, { ...filters, q: '', [key]: value }).length
  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: STATUS_FILTERS.map((s) => ({ value: s, label: `${s === 'all' ? t('filters.statusAll') : t(`status.${s}`)} (${count('status', s)})` })),
      onChange: (v) => update({ status: v as PortfolioFilters['status'] }),
    },
    {
      key: 'connection',
      label: t('filters.connection'),
      value: filters.connection,
      options: CONNECTION_FILTERS.map((c) => ({ value: c, label: `${t(`connection.${c}`)} (${count('connection', c)})` })),
      onChange: (v) => update({ connection: v as PortfolioFilters['connection'] }),
    },
  ]
  const chips: FilterChip[] = []
  if (filters.status !== 'all') chips.push({ id: 'status', label: t(`status.${filters.status}`) })
  if (filters.connection !== 'all') chips.push({ id: 'connection', label: t(`connection.${filters.connection}`) })
  const removeChip = (id: string) => update(id === 'status' ? { status: 'all' } : { connection: 'all' })

  const sortable = (key: SortColumn, header: string, width: string, render: (r: PortfolioRow) => ReactNode, className = ''): DataTableColumn<PortfolioRow> => ({
    key,
    header,
    width,
    sortable: true,
    className,
    render,
  })
  const num = (v: number | null) => <span className="block text-sm leading-6 tabular-nums">{n(v)}</span>
  const columns: DataTableColumn<PortfolioRow>[] = [
    sortable('site', t('columns.site'), 'min-w-56', (r) => <CellText primary={r.name} secondary={r.slug} href={href(r)} clamp={1} />),
    sortable('visitors7', t('columns.visitors7'), 'w-28', (r) => num(r.visitors7)),
    sortable('visitors28', t('columns.visitors28'), 'w-32', (r) => (
      <span className="flex flex-col gap-1">
        {num(r.visitors28)}
        {r.dailyVisitors.length > 1 ? <Sparkline values={r.dailyVisitors} label={t('dailyVisitors', { site: r.name })} className="h-5 w-24" /> : null}
      </span>
    )),
    sortable('trend', t('columns.trend'), 'w-28', (r) => <span className="block text-sm leading-6"><TrendText percent={r.trend} /></span>),
    sortable('searchClicks28', t('columns.searchClicks28'), 'w-32', (r) => num(r.searchClicks28)),
    { key: 'topChannel', header: t('columns.topChannel'), width: 'w-36', render: (r) => <span className="block text-sm leading-6">{channel(r.topChannel)}</span> },
    sortable('requests28', t('columns.requests28'), 'w-32', (r) => num(r.requests28)),
    sortable('status', t('columns.status'), 'w-36', (r) => <StatusPill status={r.status} />),
  ]

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        label={t('filters.label')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
        filters={selects}
        summary={t('filters.showing', { shown: shown.length, total: rows.length })}
        clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefaultPortfolioFilters(filters) }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: removeChip }}
      />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              label={t('title')}
              rows={shown}
              columns={columns}
              rowKey={(r) => r.projectId}
              rowHref={href}
              sort={{ column: filters.sort.column, dir: filters.sort.dir, onSort: (k) => update({ sort: nextPortfolioSort(k as SortColumn, filters.sort) }) }}
            />
          </div>
          <div className="md:hidden">
            <CardGrid label={t('title')}>
              {shown.map((r) => (
                <CardGridItem key={r.projectId}>
                  <ContentCard
                    media={{}}
                    mediaContent={
                      <span className="absolute inset-0 flex items-end bg-muted px-3 pb-3">
                        {r.dailyVisitors.length > 1 ? <Sparkline values={r.dailyVisitors} label={t('dailyVisitors', { site: r.name })} className="h-10 w-full" /> : null}
                      </span>
                    }
                    title={r.name}
                    subtitle={r.visitors28 === null ? connectionOf(r) === 'none' ? t('connection.none') : t('noData') : t('visitorsLine', { count: r.visitors28 })}
                    href={href(r)}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <TrendText percent={r.trend} />
                      <StatusPill status={r.status} />
                    </span>
                  </ContentCard>
                </CardGridItem>
              ))}
            </CardGrid>
          </div>
        </>
      )}
    </div>
  )
}
