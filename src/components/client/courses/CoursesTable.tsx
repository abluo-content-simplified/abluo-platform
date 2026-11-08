'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn, type DataTableSelection } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText, LocalDate } from '@/components/app/ui/list/cells'
import type { CourseSort, CourseSortColumn } from '@/lib/client/courses-filter'
import { CourseStateBadge, MissingPills, useClassesText, type CourseRow } from './course-bits'

/**
 * Desktop Courses table (md and up): the generic DataTable configured for
 * courses. Columns: Title (+ short description) · Weekly classes · Teachers ·
 * Next class · Status · Updated · ⋯. Title and Updated sort. The whole row
 * opens the editor; ⋯ doesn't. Classes, teachers and next class come from the
 * schedule and show "—" until scheduling is connected.
 */
export function CoursesTable({
  rows,
  sort,
  onSort,
  onOpen,
  menuFor,
  selection,
}: {
  rows: CourseRow[]
  sort: CourseSort
  onSort: (column: CourseSortColumn) => void
  onOpen: (row: CourseRow, newTab: boolean) => void
  menuFor: (row: CourseRow) => CardMenuItem[]
  /** Square checkboxes + select all (bulk bar); absent when the person can't change anything. */
  selection?: DataTableSelection<CourseRow>
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const classesText = useClassesText()
  const columns: DataTableColumn<CourseRow>[] = [
    {
      key: 'title',
      header: t('columns.title'),
      sortable: true,
      width: 'min-w-64',
      render: (c) => <CellText clamp={1} primary={c.title || t('untitled')} secondary={c.shortDescription || null} secondaryLines={1} href={c.href} />,
    },
    {
      key: 'classes',
      header: t('columns.classes'),
      width: 'w-36',
      render: (c) => <span className="flex min-h-6 items-center text-sm leading-6 text-foreground">{classesText(c.schedule)}</span>,
    },
    {
      key: 'teachers',
      header: t('columns.teachers'),
      width: 'w-52',
      render: (c) => <span className="line-clamp-2 text-sm leading-6 text-foreground">{c.schedule?.teachers.length ? c.schedule.teachers.join(', ') : '—'}</span>,
    },
    {
      key: 'next',
      header: t('columns.next'),
      width: 'w-36',
      render: (c) => <LocalDate iso={c.schedule?.nextClassAt} empty="—" className="text-sm leading-6 text-foreground tabular-nums" />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-48',
      render: (c) => (
        <div className="flex flex-col items-start gap-1.5">
          <CellPill>
            <CourseStateBadge state={c.state} publishedAt={c.publishedAt} zone={c.zone} />
          </CellPill>
          <MissingPills languages={c.missingLanguages} state={c.state} />
        </div>
      ),
    },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-28', render: (c) => <CellDate iso={c.updatedAt} /> },
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
