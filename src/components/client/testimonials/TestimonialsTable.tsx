'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import type { TestimonialSort, TestimonialSortColumn } from '@/lib/client/testimonials-filter'
import { MissingLanguages, RatingValue, TestimonialStateBadge, type TestimonialRow } from './testimonial-bits'

/**
 * Desktop Testimonials table (md and up): the generic DataTable configured for
 * testimonials. Columns: Name · Excerpt · Rating · Languages (multilingual
 * sites) · Featured · Status · Updated · ⋯. Name, Rating and Updated sort. The
 * whole row opens the editor; ⋯ doesn't.
 */
export function TestimonialsTable({
  rows,
  multilingual,
  sort,
  onSort,
  onOpen,
  menuFor,
}: {
  rows: TestimonialRow[]
  /** The site has more than one language: show the Languages column. */
  multilingual: boolean
  sort: TestimonialSort
  onSort: (column: TestimonialSortColumn) => void
  onOpen: (row: TestimonialRow, newTab: boolean) => void
  menuFor: (row: TestimonialRow) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.testimonials.list')
  const columns: DataTableColumn<TestimonialRow>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-44',
      render: (r) => <CellText primary={r.name} secondary={r.privateName && r.privateName !== r.name ? r.privateName : null} href={r.href} />,
    },
    {
      key: 'excerpt',
      header: t('columns.excerpt'),
      width: 'min-w-64',
      render: (r) => <span className="line-clamp-2 text-sm leading-6 break-words text-muted-foreground">{r.excerpt || '—'}</span>,
    },
    { key: 'rating', header: t('columns.rating'), sortable: true, width: 'w-24', render: (r) => <RatingValue rating={r.rating} /> },
    ...(multilingual
      ? [
          {
            key: 'languages',
            header: t('columns.languages'),
            width: 'w-36',
            render: (r: TestimonialRow) =>
              r.missingLocales.length ? (
                <CellPill>
                  <MissingLanguages locales={r.missingLocales} />
                </CellPill>
              ) : (
                <span className="text-sm leading-6 text-muted-foreground">{t('allLanguages')}</span>
              ),
          },
        ]
      : []),
    {
      key: 'featured',
      header: t('columns.featured'),
      width: 'w-28',
      render: (r) =>
        r.featured ? (
          <CellPill>
            <Pill tone="highlight">{t('featured')}</Pill>
          </CellPill>
        ) : (
          <span className="text-sm leading-6 text-muted-foreground">—</span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-48',
      render: (r) => (
        <CellPill>
          <TestimonialStateBadge state={r.state} />
        </CellPill>
      ),
    },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-28', render: (r) => <CellDate iso={r.updatedAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (r) => <CardMenu variant="cell" label={t('menu', { name: r.name })} items={menuFor(r)} />,
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      label={t('title')}
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as TestimonialSortColumn) }}
      rowHref={(r) => r.href}
      onRowClick={onOpen}
    />
  )
}
