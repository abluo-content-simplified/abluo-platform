'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/client/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/client/ui/list/DataTable'
import { CellDate, CellPill, CellText, Chips } from '@/components/client/ui/list/cells'
import { Avatar } from '@/components/client/ui/Avatar'
import type { Person } from '@/lib/people/service'
import { displayName, type PeopleFilters, type PeopleSortColumn } from '@/lib/client/people-filter'
import { StatusPill, TwoFactorPill } from './people-bits'

/**
 * Desktop People table (md and up): the generic DataTable configured for
 * people. Columns: avatar · person (name, email) · role (+ extras) · status ·
 * invited · joined · last active · two-step · ⋯. The row opens the person.
 */
export function PeopleTable({
  people,
  roleLabel,
  extraLabel,
  sort,
  onSort,
  onOpen,
  menuFor,
}: {
  people: Person[]
  roleLabel: (r: string) => string
  extraLabel: (id: string) => string
  sort: PeopleFilters['sort']
  onSort: (column: PeopleSortColumn) => void
  onOpen: (person: Person) => void
  menuFor: (person: Person) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.people')
  const columns: DataTableColumn<Person>[] = [
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
      render: (p) => (
        <CellText
          clamp={1}
          primary={
            <>
              {displayName(p)}
              {p.isYou ? <span className="font-normal text-muted-foreground"> ({t('you')})</span> : null}
            </>
          }
          secondary={p.name ? p.email : null}
        />
      ),
    },
    {
      key: 'role',
      header: t('columns.role'),
      width: 'w-44',
      render: (p) => (
        <span className="flex flex-col items-start gap-1">
          <span className="flex min-h-6 items-center text-sm text-foreground">{roleLabel(p.role)}</span>
          <Chips items={p.extras.map(extraLabel)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      width: 'w-28',
      render: (p) => (
        <CellPill>
          <StatusPill status={p.status} />
        </CellPill>
      ),
    },
    { key: 'invited', header: t('columns.invited'), sortable: true, width: 'w-28', render: (p) => <CellDate iso={p.invitedAt} /> },
    { key: 'joined', header: t('columns.joined'), sortable: true, width: 'w-28', render: (p) => <CellDate iso={p.joinedAt} /> },
    { key: 'lastActive', header: t('columns.lastActive'), sortable: true, width: 'w-28', render: (p) => <CellDate iso={p.lastActiveAt} /> },
    {
      key: 'twoFactor',
      header: t('columns.twoFactor'),
      width: 'w-24',
      render: (p) =>
        p.twoFactor === null ? (
          <CellDate iso={null} />
        ) : (
          <CellPill>
            <TwoFactorPill on={p.twoFactor} />
          </CellPill>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (p) => <CardMenu variant="cell" label={t('menu', { name: displayName(p) })} items={menuFor(p)} />,
    },
  ]
  return (
    <DataTable
      label={t('title')}
      rows={people}
      columns={columns}
      rowKey={(p) => p.key}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as PeopleSortColumn) }}
      onRowClick={(p) => onOpen(p)}
    />
  )
}

/**
 * Phone cards: avatar · name, email, role (+ extras), status · ⋯. Tapping the
 * card opens the person.
 */
export function PeoplePhoneList({
  people,
  roleLabel,
  extraLabel,
  onOpen,
  menuFor,
}: {
  people: Person[]
  roleLabel: (r: string) => string
  extraLabel: (id: string) => string
  onOpen: (person: Person) => void
  menuFor: (person: Person) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.people')
  return (
    <ul className="flex flex-col gap-3">
      {people.map((p) => (
        <li key={p.key} className="flex items-start gap-1 rounded-xl border border-border bg-card py-2 pr-1 pl-3">
          <button
            type="button"
            onClick={() => onOpen(p)}
            className="flex min-w-0 flex-1 items-start gap-3 pt-2 pb-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Avatar name={p.name} email={p.email} src={p.avatarUrl} size="md" muted={p.status !== 'active'} />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">
                {displayName(p)}
                {p.isYou ? <span className="font-normal text-muted-foreground"> ({t('you')})</span> : null}
              </span>
              {p.name ? <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">{p.email}</span> : null}
              <span className="text-sm leading-5 text-foreground">{roleLabel(p.role)}</span>
              <Chips items={p.extras.map(extraLabel)} />
              <StatusPill status={p.status} />
            </span>
          </button>
          <span className="shrink-0">
            <CardMenu label={t('menu', { name: displayName(p) })} items={menuFor(p)} />
          </span>
        </li>
      ))}
    </ul>
  )
}
