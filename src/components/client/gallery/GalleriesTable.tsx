'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellDate, CellPill, CellText } from '@/components/app/ui/list/cells'
import { ThumbStrip } from '@/components/app/ui/list/ThumbStrip'
import type { GallerySort, GallerySortColumn } from '@/lib/client/galleries-filter'
import { GalleryStatePill, type GalleryRow } from './gallery-bits'

/**
 * Desktop Galleries table (md and up): the generic DataTable configured for
 * galleries. Columns: select · photos strip · title (+ internal name) · status
 * · photos · used on · updated · created · ⋯. Title, photos and both dates
 * sort. The whole row opens the gallery; the checkbox and ⋯ don't.
 */
export function GalleriesTable({
  rows,
  canWrite,
  selected,
  onToggle,
  allState,
  onToggleAll,
  sort,
  onSort,
  onOpen,
  menuFor,
}: {
  rows: GalleryRow[]
  canWrite: boolean
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  allState: 'none' | 'some' | 'all'
  onToggleAll: (checked: boolean) => void
  sort: GallerySort
  onSort: (column: GallerySortColumn) => void
  onOpen: (row: GalleryRow, newTab: boolean) => void
  menuFor: (row: GalleryRow) => CardMenuItem[]
}) {
  const t = useTranslations('clientDashboard.gallery.list')
  const ts = useTranslations('clientDashboard.gallery.status')
  const tsel = useTranslations('clientDashboard.gallery.select')
  const columns: DataTableColumn<GalleryRow>[] = [
    {
      key: 'strip',
      header: <span className="sr-only">{t('columns.preview')}</span>,
      width: 'w-40',
      render: (g) => <ThumbStrip srcs={g.thumbs} total={g.count} size={{ width: '9rem', height: '4.5rem' }} className="rounded-lg" />,
    },
    {
      key: 'title',
      header: t('columns.title'),
      sortable: true,
      width: 'min-w-56',
      render: (g) => <CellText primary={g.title} secondary={g.internalName && g.internalName !== g.title ? g.internalName : null} href={g.href} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-44',
      render: (g) => (
        <CellPill>
          <GalleryStatePill state={g.state} />
        </CellPill>
      ),
    },
    {
      key: 'photos',
      header: t('columns.photos'),
      sortable: true,
      width: 'w-24',
      render: (g) => <span className="flex min-h-6 items-center text-sm leading-6 text-foreground tabular-nums">{g.count}</span>,
    },
    {
      key: 'usedOn',
      header: t('columns.usedOn'),
      width: 'w-48',
      render: (g) => (
        <span className={`line-clamp-2 text-sm leading-6 ${g.places.length ? 'text-foreground' : 'text-muted-foreground'}`}>
          {g.places.length ? g.places.join(' · ') : ts('notUsed')}
        </span>
      ),
    },
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-28', render: (g) => <CellDate iso={g.updatedAt} /> },
    { key: 'created', header: t('columns.created'), sortable: true, width: 'w-28', render: (g) => <CellDate iso={g.createdAt} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (g) => (canWrite ? <CardMenu variant="cell" label={t('card.menu', { title: g.title })} items={menuFor(g)} /> : null),
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(g) => g.id}
      label={t('title')}
      selection={
        canWrite
          ? {
              selected,
              onToggle,
              allState,
              onToggleAll,
              rowLabel: (g) => tsel('card', { title: g.title }),
              allLabel: t('columns.selectAll'),
            }
          : undefined
      }
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as GallerySortColumn) }}
      rowHref={(g) => g.href}
      onRowClick={onOpen}
    />
  )
}
