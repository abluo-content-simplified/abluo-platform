'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText } from '@/components/app/ui/list/cells'
import { ProjectStatusPill } from '@/components/admin/projects/ProjectStatusPill'
import {
  applyProjectFilters,
  DEFAULT_PROJECT_FILTERS,
  isDefaultProjectFilters,
  liveSiteUrl,
  nextProjectSort,
  previewSiteUrl,
  PROJECT_STATUS_FILTERS,
  type ProjectFilters,
  type ProjectListRow,
  type ProjectSortColumn,
  type ProjectStatusFilter,
} from '@/lib/admin/projects-filter'
import { adminProjectHref } from '@/lib/admin/attention'

export type ProjectsBrowserRow = ProjectListRow & { id: string; owners: { userId: string; name: string; email: string }[] }

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
  initialStatus,
}: {
  projects: ProjectsBrowserRow[]
  ownersKnown: boolean
  initialStatus: ProjectStatusFilter
}) {
  const t = useTranslations('admin.projects')
  const router = useRouter()
  const start: ProjectFilters = { ...DEFAULT_PROJECT_FILTERS, status: initialStatus }
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
  ]
  const chips: FilterChip[] = filters.status !== DEFAULT_PROJECT_FILTERS.status ? [{ id: 'status', label: t(`statusFilters.${filters.status}`) }] : []
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
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: () => update({ status: DEFAULT_PROJECT_FILTERS.status }) }}
      />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('noMatch')}</p>
          {!isDefault ? (
            <button
              type="button"
              onClick={reset}
              className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('clear')}
            </button>
          ) : null}
        </div>
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
              <li key={p.id} className="flex items-start gap-1 rounded-xl border border-border bg-card py-2 pr-1 pl-4">
                <Link
                  href={adminProjectHref(p.slug)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1.5 pt-2 pb-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{p.name}</span>
                  <span className="line-clamp-1 text-sm leading-5 break-all text-muted-foreground">
                    {[p.client?.name, p.customDomain ?? p.slug].filter(Boolean).join(' · ')}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <ProjectStatusPill status={p.status} />
                    {ownersKnown && !p.owners.length ? <span className="text-sm leading-5 font-medium text-destructive">{t('noOwner')}</span> : null}
                  </span>
                </Link>
                <span className="shrink-0">
                  <CardMenu label={t('menu', { name: p.name })} items={menuFor(p)} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
