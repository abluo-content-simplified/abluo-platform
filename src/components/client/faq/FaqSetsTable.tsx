'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText } from '@/components/app/ui/list/cells'
import type { FaqSort, FaqSortColumn } from '@/lib/client/faq-sets-filter'
import { FaqStateBadge, MissingLanguages, type FaqRow } from './faq-bits'

/**
 * Desktop FAQ Sets table (md and up): the generic DataTable configured for
 * FAQ sets. Columns: Name · Questions · Languages (multilingual sites) ·
 * Used in · Status · Updated · ⋯. Name, Questions and Updated sort. The whole
 * row opens the editor; "Used in" and ⋯ don't.
 */
export function FaqSetsTable({
  rows,
  canWrite,
  multilingual,
  sort,
  onSort,
  onOpen,
  onUsedIn,
  menuFor,
}: {
  rows: FaqRow[]
  canWrite: boolean
  /** The site has more than one language: show the Languages column. */
  multilingual: boolean
  sort: FaqSort
  onSort: (column: FaqSortColumn) => void
  onOpen: (row: FaqRow, newTab: boolean) => void
  onUsedIn: (row: FaqRow) => void
  menuFor: (row: FaqRow) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.faq.list')
  const columns: DataTableColumn<FaqRow>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-56',
      render: (s) => <CellText primary={s.name} secondary={s.firstQuestions[0] ?? null} href={s.href} />,
    },
    {
      key: 'questions',
      header: t('columns.questions'),
      sortable: true,
      width: 'w-28',
      render: (s) => <span className="flex min-h-6 items-center text-sm leading-6 text-foreground tabular-nums">{s.count}</span>,
    },
    ...(multilingual
      ? [
          {
            key: 'languages',
            header: t('columns.languages'),
            width: 'w-36',
            render: (s: FaqRow) =>
              s.missingLocales.length ? (
                <CellPill>
                  <MissingLanguages locales={s.missingLocales} />
                </CellPill>
              ) : (
                <span className="text-sm leading-6 text-muted-foreground">{t('allLanguages')}</span>
              ),
          },
        ]
      : []),
    {
      key: 'usedIn',
      header: t('columns.usedIn'),
      width: 'w-36',
      render: (s) =>
        s.usedIn.length ? (
          <Button variant="link" className="-my-2.5 text-sm" onClick={() => onUsedIn(s)} aria-label={t('usedInOpen', { name: s.name, count: s.usedIn.length })}>
            {t('usedInCount', { count: s.usedIn.length })}
          </Button>
        ) : (
          <span className="text-sm leading-6 text-muted-foreground">{t('notUsed')}</span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-48',
      render: (s) => (
        <CellPill>
          <FaqStateBadge state={s.state} />
        </CellPill>
      ),
    },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-28', render: (s) => <CellDate iso={s.updatedAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (s) => (canWrite ? <CardMenu variant="cell" label={t('menu', { name: s.name })} items={menuFor(s)} /> : null),
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(s) => s.id}
      label={t('title')}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as FaqSortColumn) }}
      rowHref={(s) => s.href}
      onRowClick={onOpen}
    />
  )
}
