'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellDate, CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { BillingStatusPill } from '@/components/app/ui/BillingStatusPill'
import { ProjectStatusPill } from '@/components/admin/projects/ProjectStatusPill'
import {
  applyProjectFilters,
  DEFAULT_PROJECT_FILTERS,
  isDefaultProjectFilters,
  liveSiteUrl,
  nextProjectSort,
  previewSiteUrl,
  PROJECT_BILLING_FILTERS,
  PROJECT_STATUS_FILTERS,
  type ProjectBillingFilter,
  type ProjectFilters,
  type ProjectListRow,
  type ProjectSortColumn,
  type ProjectStatusFilter,
} from '@/lib/admin/projects-filter'
import { adminProjectHref } from '@/lib/admin/attention'
import type { BillingStatusView } from '@/lib/admin/billing/types'
import type { TranslationUsageSummary } from '@/lib/translate/usage-view'

export type ProjectsBrowserRow = ProjectListRow & {
  id: string
  owners: { userId: string; name: string; email: string }[]
  /** Translations this month; null = not loaded. */
  translations?: TranslationUsageSummary | null
}

/** The pill's status from a list summary (no clock or days-left on the list). */
const billingView = (b: NonNullable<ProjectsBrowserRow['billing']>): BillingStatusView => ({ state: b.state, reason: b.reason, day: b.day, daysLeft: null, clockStartedAt: null })

/**
 * "Not Billed" is the resting state of most rows: plain muted text, so it sits
 * flush with the column header (a faint pill read as indented — Tom, 2026-11-02).
 * Every real billing state keeps its pill.
 */
/**
 * Translations this month (Tom, 2026-11-08): "12,400 / 50,000" with the share
 * under it, a highlight pill from 80 % of the limit on, "No limit" when the
 * site has none, "Off" when the Translate module is not on.
 */
function TranslationsCell({ p }: { p: ProjectsBrowserRow }) {
  const t = useTranslations('admin.projects.translationUsage')
  const locale = useLocale()
  const u = p.translations
  const n = (v: number) => new Intl.NumberFormat(locale).format(v)
  if (!u || u.kind === 'off') return <span className="text-sm text-muted-foreground">{t('off')}</span>
  if (u.kind === 'unavailable') return <span className="text-sm text-muted-foreground">{t('unavailable')}</span>
  if (u.limit === null) return <CellText clamp={1} primary={n(u.used)} secondary={t('noLimit')} />
  const percent = Math.round((u.share ?? 0) * 100)
  const secondary =
    u.state === 'reached' ? <Pill tone="highlight">{t('reached')}</Pill> : u.state === 'near' ? <Pill tone="highlight">{t('percent', { percent })}</Pill> : t('percent', { percent })
  return <CellText clamp={1} primary={t('cell', { used: n(u.used), limit: n(u.limit) })} secondary={secondary} />
}

function BillingCell({ p }: { p: ProjectsBrowserRow }) {
  const t = useTranslations('app.billingStatus')
  if (!p.billing) return <span className="text-sm text-muted-foreground">{t('notBilled')}</span>
  return <CellPill><BillingStatusPill status={billingView(p.billing)} billed={p.billing.billed} /></CellPill>
}

/** Owners shown in a cell before "+N more". */
const OWNERS_SHOWN = 2

const openTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

/**
 * Admin Projects list (ADR-030): the shared list pattern — ListToolbar
 * (search + status filter, default everything but inactive), DataTable on
 * computers, compact cards on phones, a ⋯ menu per project. A row opens the
 * admin project page. Filtering is client-side on the loaded list.
 */
export function ProjectsBrowser({
  projects,
  ownersKnown,
  billingKnown,
  initialStatus,
  initialBilling,
}: {
  projects: ProjectsBrowserRow[]
  ownersKnown: boolean
  /** False when the billing read failed: no billing column data or filter. */
  billingKnown: boolean
  initialStatus: ProjectStatusFilter
  initialBilling: ProjectBillingFilter
}) {
  const t = useTranslations('admin.projects')
  const router = useRouter()
  const start: ProjectFilters = { ...DEFAULT_PROJECT_FILTERS, status: initialStatus, billing: billingKnown ? initialBilling : DEFAULT_PROJECT_FILTERS.billing }
  const [filters, setFilters] = useState<ProjectFilters>(start)
  const update = (patch: Partial<ProjectFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_PROJECT_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyProjectFilters(projects, filters), [projects, filters])

  const count = (s: ProjectStatusFilter) => applyProjectFilters(projects, { ...filters, q: '', status: s }).length
  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('statusFilter'),
      value: filters.status,
      options: PROJECT_STATUS_FILTERS.map((s) => ({ value: s, label: `${t(`statusFilters.${s}`)} (${count(s)})` })),
      onChange: (v) => update({ status: v as ProjectStatusFilter }),
    },
    ...(billingKnown
      ? [
          {
            key: 'billing',
            label: t('billingFilter'),
            value: filters.billing,
            options: PROJECT_BILLING_FILTERS.map((b) => ({
              value: b,
              label: `${t(`billingFilters.${b}`)} (${applyProjectFilters(projects, { ...filters, q: '', billing: b }).length})`,
            })),
            onChange: (v: string) => update({ billing: v as ProjectBillingFilter }),
          } satisfies ListToolbarFilter,
        ]
      : []),
  ]
  const chips: FilterChip[] = [
    ...(filters.status !== DEFAULT_PROJECT_FILTERS.status ? [{ id: 'status', label: t(`statusFilters.${filters.status}`) }] : []),
    ...(filters.billing !== DEFAULT_PROJECT_FILTERS.billing ? [{ id: 'billing', label: `${t('billingFilter')}: ${t(`billingFilters.${filters.billing}`)}` }] : []),
  ]
  const isDefault = isDefaultProjectFilters(filters)

  const menuFor = (p: ProjectsBrowserRow): CardMenuItem[] => {
    const live = p.status === 'active' ? liveSiteUrl(p.customDomain) : null
    return [
      { key: 'open', label: t('actions.open'), onSelect: () => router.push(adminProjectHref(p.slug)) },
      { key: 'preview', label: t('actions.previewSite'), onSelect: () => openTab(previewSiteUrl(p.slug)) },
      ...(live ? [{ key: 'live', label: t('actions.liveSite'), onSelect: () => openTab(live) }] : []),
      { key: 'studio', label: t('actions.openStudio'), onSelect: () => openTab('/studio') },
    ]
  }

  const owners = (p: ProjectsBrowserRow) => {
    if (!ownersKnown) return <span className="text-sm leading-6 text-muted-foreground">{t('ownersUnknown')}</span>
    if (!p.owners.length) return <span className="text-sm leading-6 font-medium text-destructive">{t('noOwner')}</span>
    const names = p.owners.map((o) => o.name || o.email)
    const rest = names.length - OWNERS_SHOWN
    return (
      <span className="flex flex-col items-start text-sm leading-6 text-foreground">
        {names.slice(0, OWNERS_SHOWN).map((n, i) => (
          <span key={`${n}-${i}`} className="line-clamp-1 break-all">
            {n}
          </span>
        ))}
        {rest > 0 ? <span className="text-muted-foreground">{t('moreOwners', { count: rest })}</span> : null}
      </span>
    )
  }

  const columns: DataTableColumn<ProjectsBrowserRow>[] = [
    {
      key: 'name',
      header: t('columns.project'),
      sortable: true,
      width: 'min-w-56',
      render: (p) => <CellText clamp={1} primary={p.name} secondary={<span className="font-mono text-xs">{p.slug}</span>} href={adminProjectHref(p.slug)} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      width: 'w-32',
      render: (p) => (
        <CellPill>
          <ProjectStatusPill status={p.status} />
        </CellPill>
      ),
    },
    ...(billingKnown ? [{ key: 'billing', header: t('columns.billing'), width: 'w-36', render: (p: ProjectsBrowserRow) => <BillingCell p={p} /> }] : []),
    { key: 'translations', header: t('columns.translations'), width: 'w-40', render: (p: ProjectsBrowserRow) => <TranslationsCell p={p} /> },
    {
      key: 'domain',
      header: t('columns.domain'),
      width: 'w-48',
      render: (p) => <span className="line-clamp-1 text-sm leading-6 break-all text-muted-foreground">{p.customDomain ?? '—'}</span>,
    },
    {
      key: 'client',
      header: t('columns.client'),
      sortable: true,
      width: 'w-44',
      render: (p) => <span className="line-clamp-2 text-sm leading-6 text-foreground">{p.client?.name ?? '—'}</span>,
    },
    { key: 'owners', header: t('columns.owners'), width: 'w-52', render: owners },
    { key: 'created', header: t('columns.created'), sortable: true, width: 'w-32', render: (p) => <CellDate iso={p.createdAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (p) => <CardMenu variant="cell" label={t('menu', { name: p.name })} items={menuFor(p)} />,
    },
  ]

  return (
    <div className="space-y-4">
      <ListToolbar
        label={t('filters')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('search'), placeholder: t('searchPlaceholder') }}
        filters={selects}
        summary={t('showing', { shown: shown.length, total: projects.length })}
        clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: (id) => update(id === 'billing' ? { billing: DEFAULT_PROJECT_FILTERS.billing } : { status: DEFAULT_PROJECT_FILTERS.status }) }}
      />

      {shown.length === 0 ? (
        <EmptyState
          titleAs="p"
          title={t('noMatch')}
          action={
            !isDefault ? (
              <Button onClick={reset}>{t('clear')}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              label={t('title')}
              rows={shown}
              columns={columns}
              rowKey={(p) => p.id}
              sort={{ column: filters.sort.column, dir: filters.sort.dir, onSort: (key) => update({ sort: nextProjectSort(key as ProjectSortColumn, filters.sort) }) }}
              rowHref={(p) => adminProjectHref(p.slug)}
            />
          </div>
          <ul aria-label={t('title')} className="flex flex-col gap-3 md:hidden">
            {shown.map((p) => (
              <ListRow key={p.id} href={adminProjectHref(p.slug)} menu={{ label: t('menu', { name: p.name }), items: menuFor(p) }}>
                <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{p.name}</span>
                <span className="line-clamp-1 text-sm leading-5 break-all text-muted-foreground">
                  {[p.client?.name, p.customDomain ?? p.slug].filter(Boolean).join(' · ')}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <ProjectStatusPill status={p.status} />
                  {billingKnown ? <BillingCell p={p} /> : null}
                  {ownersKnown && !p.owners.length ? <span className="text-sm leading-5 font-medium text-destructive">{t('noOwner')}</span> : null}
                </span>
              </ListRow>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
