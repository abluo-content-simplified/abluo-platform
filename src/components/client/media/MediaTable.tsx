'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellChips, CellDate, CellImage, CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { CellFileInfo } from '@/components/app/ui/list/file-cells'
import type { MediaLibraryItem, MediaUsage } from '@/lib/api/media-library'
import { localeFor, needsDescription, type LocaleOf, type MediaFilters, type MediaSortColumn } from '@/lib/client/media-filter'
import { MEDIA_ICONS } from './MediaPhotoSheet'

/**
 * Desktop Media table (md and up): the generic DataTable configured for the
 * Media Library. Columns: select · photo · name (+ file name) · size
 * (W × H px, file size) · uploaded · tags · used in (count + where) ·
 * description (described / missing in the default language) · focus point ·
 * ⋯. Sortable: name, size, uploaded. A click on the row opens the same photo
 * panel as the grid; the checkbox and ⋯ keep their own click.
 */
export function MediaTable({
  items,
  defaultLocale,
  nameOf,
  selected,
  onToggle,
  allState,
  onToggleAll,
  sort,
  onSort,
  onOpen,
  menuFor,
  projectColumn,
  selectable = true,
}: {
  items: MediaLibraryItem[]
  /** The site's default language, or per photo when the list spans several sites. */
  defaultLocale: LocaleOf<MediaLibraryItem>
  nameOf: (item: MediaLibraryItem) => string
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  allState: 'none' | 'some' | 'all'
  onToggleAll: (checked: boolean) => void
  sort: MediaFilters['sort']
  onSort: (column: MediaSortColumn) => void
  onOpen: (item: MediaLibraryItem) => void
  menuFor: (item: MediaLibraryItem) => CardMenuItem[]
  /** Header of a "Project" column after the name (lists that span several projects); none when absent. */
  projectColumn?: string
  /** Show the select checkboxes (off when selecting is not available). */
  selectable?: boolean
}) {
  const t = useTranslations('clientDashboard.media')
  const tu = useTranslations('clientDashboard.media.usedIn')

  const where = (usedIn: MediaUsage[]) =>
    usedIn
      .slice(0, 3)
      .map((u) => `${tu(`kind.${u.kind}`)}: ${u.title || tu('untitled')}`)
      .join(' · ') + (usedIn.length > 3 ? ` · +${usedIn.length - 3}` : '')

  const columns: DataTableColumn<MediaLibraryItem>[] = [
    {
      key: 'image',
      header: <span className="sr-only">{t('columns.image')}</span>,
      width: 'w-28',
      render: (i) => <CellImage src={i.thumbUrl} focal={i.focal} />,
    },
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-48',
      render: (i) => {
        const name = nameOf(i)
        return <CellText primary={name} secondary={i.filename && i.filename !== name ? i.filename : undefined} clamp={2} />
      },
    },
    ...(projectColumn
      ? [
          {
            key: 'project',
            header: projectColumn,
            width: 'min-w-36',
            render: (i: MediaLibraryItem) => <CellText primary={i.project?.name ?? ''} clamp={1} />,
          },
        ]
      : []),
    {
      key: 'size',
      header: t('columns.size'),
      sortable: true,
      width: 'w-36',
      render: (i) => <CellFileInfo width={i.width} height={i.height} bytes={i.bytes} />,
    },
    {
      key: 'uploaded',
      header: t('columns.uploaded'),
      sortable: true,
      width: 'w-28',
      render: (i) => <CellDate iso={i.createdAt} />,
    },
    {
      key: 'tags',
      header: t('columns.tags'),
      width: 'w-40',
      render: (i) => <CellChips items={i.tags} max={3} />,
    },
    {
      key: 'usage',
      header: t('columns.usage'),
      width: 'min-w-44',
      render: (i) => (
        <CellText
          clamp={1}
          primary={<span className={i.usedIn.length ? '' : 'font-normal text-muted-foreground'}>{t('library.usage', { count: i.usedIn.length })}</span>}
          secondary={i.usedIn.length ? where(i.usedIn) : undefined}
        />
      ),
    },
    {
      key: 'description',
      header: t('columns.description'),
      width: 'w-32',
      render: (i) => (
        <CellPill>
          {needsDescription(i, localeFor(defaultLocale, i)) ? <Pill tone="outline">{t('pill.missing')}</Pill> : <Pill tone="success">{t('pill.described')}</Pill>}
        </CellPill>
      ),
    },
    {
      key: 'focal',
      header: t('columns.focal'),
      width: 'w-28',
      render: (i) => (
        <CellPill>
          {i.focal ? (
            <Pill tone="muted" icon={MEDIA_ICONS.focal}>
              {t('pill.focalSet')}
            </Pill>
          ) : (
            <span className="flex min-h-6 items-center text-sm text-muted-foreground">{t('pill.focalNone')}</span>
          )}
        </CellPill>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (i) => <CardMenu variant="cell" label={t('menu.label', { name: nameOf(i) })} items={menuFor(i)} />,
    },
  ]

  return (
    <DataTable
      label={t('library.title')}
      rows={items}
      columns={columns}
      rowKey={(i) => i.assetId}
      minWidth="min-w-[64rem]"
      selection={
        selectable
          ? {
              selected,
              onToggle,
              allState,
              onToggleAll,
              rowLabel: (i) => t('select.photo', { name: nameOf(i) }),
              allLabel: t('columns.selectAll'),
            }
          : undefined
      }
      sort={{ column: sort.column, dir: sort.dir, onSort: (key) => onSort(key as MediaSortColumn) }}
      onRowClick={(i) => onOpen(i)}
    />
  )
}
