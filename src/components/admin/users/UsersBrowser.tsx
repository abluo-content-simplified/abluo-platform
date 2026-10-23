'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar } from '@/components/app/ui/Avatar'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellPill, CellText } from '@/components/app/ui/list/cells'
import { TwoFactorPill } from '@/components/client/people/people-bits'
import {
  applyUserFilters,
  DEFAULT_USER_FILTERS,
  isDefaultUserFilters,
  nextUserSort,
  USER_ROLE_FILTERS,
  USER_STATUS_FILTERS,
  type AdminPerson,
  type UserFilters,
  type UserRoleFilter,
  type UserSortColumn,
  type UserStatusFilter,
} from '@/lib/admin/users-model'
import { AccessSummary, LastActive, SuperAdminPill, userHref, UserStatusPill } from './users-bits'

/**
 * Admin Users list (ADR-030 A1) — a Records screen: ListToolbar (search, site,
 * role, status), DataTable on computers, ListRow on phones, no cards. One row
 * per person across Abluo; the row opens the person. Filtering is client-side
 * on the snapshot the page read (Update re-reads it).
 */
export function UsersBrowser({ people, projects, now }: { people: AdminPerson[]; projects: { id: string; name: string }[]; now: number }) {
  const t = useTranslations('admin.users')
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_USER_FILTERS)
  const update = (patch: Partial<UserFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_USER_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyUserFilters(people, filters), [people, filters])
  const label = (p: AdminPerson) => p.name || p.email

  const selects: ListToolbarFilter[] = [
    {
      key: 'project',
      label: t('filters.site'),
      value: filters.project,
      options: [{ value: 'all', label: t('filters.allSites') }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
      onChange: (v) => update({ project: v }),
    },
    {
      key: 'role',
      label: t('filters.role'),
      value: filters.role,
      options: USER_ROLE_FILTERS.map((r) => ({ value: r, label: t(`filters.roles.${r}`) })),
      onChange: (v) => update({ role: v as UserRoleFilter }),
    },
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: USER_STATUS_FILTERS.map((s) => ({ value: s, label: t(`filters.statuses.${s}`) })),
      onChange: (v) => update({ status: v as UserStatusFilter }),
    },
  ]
  const chips: FilterChip[] = [
    ...(filters.project !== 'all' ? [{ id: 'project', label: projects.find((p) => p.id === filters.project)?.name ?? '' }] : []),
    ...(filters.role !== 'all' ? [{ id: 'role', label: t(`filters.roles.${filters.role}`) }] : []),
    ...(filters.status !== 'all' ? [{ id: 'status', label: t(`filters.statuses.${filters.status}`) }] : []),
  ]
  const isDefault = isDefaultUserFilters(filters)

  const columns: DataTableColumn<AdminPerson>[] = [
    {
      key: 'avatar',
      header: <span className="sr-only">{t('columns.avatar')}</span>,
      width: 'w-12',
      render: (p) => (
        <span className="-mt-1 block">
          <Avatar name={p.name} email={p.email} src={p.avatarUrl} size="sm" muted={p.status !== 'active'} />
        </span>
      ),
    },
    {
      key: 'name',
      header: t('columns.person'),
      sortable: true,
      width: 'min-w-56',
      render: (p) => <CellText clamp={1} primary={label(p)} secondary={p.name ? p.email : null} href={userHref(p.key)} />,
    },
    { key: 'access', header: t('columns.access'), width: 'w-52', render: (p) => <AccessSummary person={p} /> },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      width: 'w-36',
      render: (p) => (
        <CellPill>
          <UserStatusPill status={p.status} />
          {p.superAdmin ? <SuperAdminPill /> : null}
        </CellPill>
      ),
    },
    {
      key: 'twoFactor',
      header: t('columns.twoFactor'),
      width: 'w-24',
      render: (p) =>
        p.twoFactor === null ? (
          <span className="text-sm leading-6 text-muted-foreground">—</span>
        ) : (
          <CellPill>
            <TwoFactorPill on={p.twoFactor} />
          </CellPill>
        ),
    },
    { key: 'lastActive', header: t('columns.lastActive'), sortable: true, width: 'w-44', render: (p) => <LastActive iso={p.lastActiveAt} now={now} /> },
  ]

  return (
    <div className="space-y-4">
      <ListToolbar
        label={t('filters.label')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('search'), placeholder: t('searchPlaceholder') }}
        filters={selects}
        summary={t('showing', { shown: shown.length, total: people.length })}
        clear={{ label: t('clear'), onClear: reset, visible: !isDefault }}
        sheet={{
          activeCount: chips.length,
          resultCount: shown.length,
          chips,
          onRemoveChip: (id) => update(id === 'project' ? { project: 'all' } : id === 'role' ? { role: 'all' } : { status: 'all' }),
        }}
      />

      {shown.length === 0 ? (
        <EmptyState titleAs="p" title={t('noMatch')} action={!isDefault ? <Button onClick={reset}>{t('clear')}</Button> : undefined} />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              label={t('title')}
              rows={shown}
              columns={columns}
              rowKey={(p) => p.key}
              sort={{ column: filters.sort.column, dir: filters.sort.dir, onSort: (key) => update({ sort: nextUserSort(key as UserSortColumn, filters.sort) }) }}
              rowHref={(p) => userHref(p.key)}
            />
          </div>
          <ul aria-label={t('title')} className="flex flex-col gap-3 md:hidden">
            {shown.map((p) => (
              <ListRow key={p.key} href={userHref(p.key)} leading={<Avatar name={p.name} email={p.email} src={p.avatarUrl} size="sm" muted={p.status !== 'active'} />}>
                <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{label(p)}</span>
                {p.name ? <span className="line-clamp-1 text-sm leading-5 break-all text-muted-foreground">{p.email}</span> : null}
                <AccessSummary person={p} />
                <span className="flex flex-wrap items-center gap-2">
                  <UserStatusPill status={p.status} />
                  {p.superAdmin ? <SuperAdminPill /> : null}
                  <LastActive iso={p.lastActiveAt} now={now} />
                </span>
              </ListRow>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
