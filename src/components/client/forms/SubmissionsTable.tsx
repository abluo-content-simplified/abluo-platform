'use client'

import { useTranslations } from 'next-intl'
import type { DashboardSubmission, SubmissionStatus } from '@/lib/api/client-dashboard'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText } from '@/components/app/ui/list/cells'
import { firstLine, type SubmissionFilters, type SubmissionSortColumn } from '@/lib/client/submissions-filter'
import { humanizeValue } from './SubmissionDetail'
import { SubmissionStatusPill, SubmissionStatusSelect } from './forms-bits'

const MUTED = 'line-clamp-2 text-sm leading-6 break-words text-muted-foreground'

/**
 * Desktop Forms table (md and up): the generic DataTable configured for
 * contact requests. Columns: select · name · email · form · subject (or the
 * first line of the message) · received (sortable) · status · ⋯. The row
 * opens the request's panel; the checkbox, status select and ⋯ don't.
 * Without forms.submission.update the status is a read-only pill.
 */
export function SubmissionsTable({
  rows,
  canUpdate,
  selected,
  onToggle,
  allState,
  onToggleAll,
  sort,
  onSort,
  onOpen,
  onStatus,
  menuFor,
}: {
  rows: DashboardSubmission[]
  canUpdate: boolean
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  allState: 'none' | 'some' | 'all'
  onToggleAll: (checked: boolean) => void
  sort: SubmissionFilters['sort']
  onSort: (column: SubmissionSortColumn) => void
  onOpen: (row: DashboardSubmission) => void
  onStatus: (row: DashboardSubmission, next: SubmissionStatus) => void
  menuFor: (row: DashboardSubmission) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.submissions')
  const nameOf = (s: DashboardSubmission) => s.name ?? t('anonymous')

  const columns: DataTableColumn<DashboardSubmission>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-40',
      render: (s) => <CellText primary={nameOf(s)} clamp={1} />,
    },
    {
      key: 'email',
      header: t('columns.email'),
      width: 'w-52',
      render: (s) => <span className="line-clamp-1 text-sm leading-6 break-all text-muted-foreground">{s.email ?? '—'}</span>,
    },
    {
      key: 'form',
      header: t('columns.form'),
      width: 'w-36',
      render: (s) => <span className="line-clamp-1 text-sm leading-6 text-muted-foreground">{s.formId}</span>,
    },
    {
      key: 'subject',
      header: t('columns.subject'),
      width: 'min-w-56',
      render: (s) => {
        const subject = s.data.subject
        const text = subject ? humanizeValue(subject) : firstLine(s)
        return <span className={MUTED}>{text || '—'}</span>
      },
    },
    {
      key: 'received',
      header: t('columns.received'),
      sortable: true,
      width: 'w-32',
      className: 'whitespace-nowrap',
      render: (s) => <CellDate iso={s.createdAt} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-36',
      render: (s) => (
        <CellPill>
          {canUpdate ? (
            <SubmissionStatusSelect status={s.status} label={`${t('columns.status')}: ${nameOf(s)}`} onChange={(next) => onStatus(s, next)} />
          ) : (
            <SubmissionStatusPill status={s.status} />
          )}
        </CellPill>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (s) => <CardMenu variant="cell" label={t('menu', { name: nameOf(s) })} items={menuFor(s)} />,
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(s) => s.id}
      label={t('title')}
      selection={{
        selected,
        onToggle,
        allState,
        onToggleAll,
        rowLabel: (s) => t('selectRow', { name: nameOf(s) }),
        allLabel: t('selectAll'),
      }}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as SubmissionSortColumn) }}
      onRowClick={(s) => onOpen(s)}
    />
  )
}
