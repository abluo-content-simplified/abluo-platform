'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn, type DataTableSelection } from '@/components/app/ui/list/DataTable'
import type { CourseSort, CourseSortColumn } from '@/lib/client/courses-filter'
import { CourseNextClass, CourseRunsUntil, CourseStatusPill, CourseTitleCell, CourseWhen, type CourseListContext, type CourseRow } from './course-bits'

/**
 * Desktop Courses table (md and up): the generic DataTable configured for
 * courses (Tom, 2026-11-08). Columns: Course (colour dot, title, teachers) ·
 * When (the weekly classes, "+N" expands the row in place) · Next class (+ the
 * nearest change) · Runs until · Status (one pill) · ⋯. Title sorts; "Recently
 * updated" stays a sort option of the toolbar. The whole row opens the editor —
 * except the When cell's "+N" and the ⋯ menu.
 */
export function CoursesTable({
  rows,
  ctx,
  sort,
  onSort,
  onOpen,
  menuFor,
  selection,
  expandedId,
  onToggleExpanded,
}: {
  rows: CourseRow[]
  ctx: CourseListContext
  sort: CourseSort
  onSort: (column: CourseSortColumn) => void
  onOpen: (row: CourseRow, newTab: boolean) => void
  menuFor: (row: CourseRow) => CardMenuItem[]
  /** Square checkboxes + select all (bulk bar); absent when the person can't change anything. */
  selection?: DataTableSelection<CourseRow>
  /** The one row whose classes are all shown. */
  expandedId: string | null
  onToggleExpanded: (id: string) => void
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const columns: DataTableColumn<CourseRow>[] = [
    { key: 'title', header: t('columns.title'), sortable: true, width: 'min-w-56', render: (c) => <CourseTitleCell row={c} /> },
    {
      key: 'when',
      header: t('columns.when'),
      width: 'w-48',
      render: (c) => <CourseWhen row={c} ctx={ctx} expanded={expandedId === c.id} onToggle={() => onToggleExpanded(c.id)} />,
    },
    { key: 'next', header: t('columns.next'), width: 'w-40', render: (c) => <CourseNextClass row={c} ctx={ctx} /> },
    { key: 'until', header: t('columns.until'), width: 'w-36', render: (c) => <CourseRunsUntil row={c} ctx={ctx} /> },
    { key: 'status', header: t('columns.status'), width: 'w-48', render: (c) => <CourseStatusPill row={c} ctx={ctx} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (c) => <CardMenu variant="cell" label={t('menu', { name: c.title })} items={menuFor(c)} />,
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(c) => c.id}
      label={t('title')}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as CourseSortColumn) }}
      rowHref={(c) => c.href}
      selection={selection}
      onRowClick={onOpen}
    />
  )
}
