'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DragGrip } from '@/components/app/ui/DragGrip'
import { DataTable, type DataTableColumn, type DataTableSelection } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText } from '@/components/app/ui/list/cells'
import { dropEdgeClass, type usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import type { PersonSort, PersonSortColumn } from '@/lib/client/persons-filter'
import { GroupPills, MissingPills, PersonAvatar, PersonStateBadge, usageLine, VisibilityText, type PersonRow } from './person-bits'

export type PersonReorder = {
  drag: ReturnType<typeof usePointerDrag>
  move: (id: string, direction: -1 | 1) => void
  disabled: boolean
}

/**
 * Desktop People table (md and up): the generic DataTable configured for
 * people. Columns: [grip] · Name (photo or initials, name, job title) ·
 * Groups · On the website · Used in · Status · Updated · ⋯. Name and Updated
 * sort. The whole row opens the editor; "Used in" and ⋯ don't. With the whole
 * list in the site order (`reorder`), the grip drags a person to a new place.
 */
export function PeopleTable({
  rows,
  sort,
  onSort,
  onOpen,
  onUsedIn,
  menuFor,
  groupLabel,
  reorder,
  selection,
}: {
  rows: PersonRow[]
  sort: PersonSort
  onSort: (column: PersonSortColumn) => void
  onOpen: (row: PersonRow, newTab: boolean) => void
  onUsedIn: (row: PersonRow) => void
  menuFor: (row: PersonRow) => CardMenuItem[]
  groupLabel: (key: string) => string
  /** Present only while dragging makes sense (no search or filter, site order). */
  reorder?: PersonReorder
  /** Square checkboxes + select all (bulk bar); absent when the person can't change anything. */
  selection?: DataTableSelection<PersonRow>
}) {
  const t = useTranslations('clientDashboard.persons.list')
  const tu = useTranslations('clientDashboard.persons.usedIn')
  const columns: DataTableColumn<PersonRow>[] = [
    ...(reorder
      ? [
          {
            key: 'grip',
            header: <span className="sr-only">{t('columns.order')}</span>,
            width: 'w-12',
            render: (p: PersonRow) => (
              <DragGrip
                label={t('drag', { name: p.name, position: rows.findIndex((r) => r.id === p.id) + 1, total: rows.length })}
                drag={reorder.drag.gripProps(p.id)}
                onMove={(dir) => reorder.move(p.id, dir)}
                disabled={reorder.disabled}
                className="-mt-1.5"
              />
            ),
          },
        ]
      : []),
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-64',
      render: (p) => (
        <div className="flex items-start gap-3">
          <span className="-mt-1 block shrink-0">
            <PersonAvatar name={p.name} src={p.photoUrl} size="sm" muted={p.state === 'archived'} />
          </span>
          <CellText clamp={1} primary={p.name} secondary={p.jobTitle || null} secondaryLines={1} href={p.href} />
        </div>
      ),
    },
    {
      key: 'groups',
      header: t('columns.groups'),
      width: 'w-48',
      render: (p) => (p.groups.length ? <GroupPills groups={p.groups} label={groupLabel} /> : <span className="text-sm leading-6 text-muted-foreground">—</span>),
    },
    {
      key: 'visibility',
      header: t('columns.visibility'),
      width: 'w-36',
      render: (p) => (
        <span className="flex min-h-6 items-center text-sm leading-6 text-foreground">
          <VisibilityText visibility={p.visibility} />
        </span>
      ),
    },
    {
      key: 'usedIn',
      header: t('columns.usedIn'),
      width: 'w-40',
      render: (p) =>
        p.usageCount ? (
          <Button variant="link" className="-my-2.5 text-left text-sm" onClick={() => onUsedIn(p)} aria-label={t('usedInOpen', { name: p.name, count: p.usageCount })}>
            {usageLine(tu, p.usage)}
          </Button>
        ) : (
          <span className="text-sm leading-6 text-muted-foreground">{t('notUsed')}</span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-48',
      render: (p) => (
        <div className="flex flex-col items-start gap-1.5">
          <CellPill>
            <PersonStateBadge state={p.state} />
          </CellPill>
          <MissingPills missing={p.missing} state={p.state} />
        </div>
      ),
    },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-28', render: (p) => <CellDate iso={p.updatedAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (p) => <CardMenu variant="cell" label={t('menu', { name: p.name })} items={menuFor(p)} />,
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(p) => p.id}
      label={t('title')}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as PersonSortColumn) }}
      rowHref={(p) => p.href}
      selection={selection}
      onRowClick={onOpen}
      rowProps={
        reorder
          ? (p) => ({ ...reorder.drag.rowProps(p.id), className: `${dropEdgeClass(reorder.drag.edge(p.id))} ${reorder.drag.dragging === p.id ? 'opacity-50' : ''}` })
          : undefined
      }
    />
  )
}
