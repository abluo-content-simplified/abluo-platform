'use client'

import { useTranslations } from 'next-intl'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CellChips, CellDate, CellIcon, CellImage, CellPill, CellText } from '@/components/app/ui/list/cells'
import { sortState, type PostSort, type SortColumn } from '@/lib/client/posts-filter'
import { FeaturedStar, ICONS, LanguageTicks, StatusPill } from './post-bits'
import type { BrowserPost } from './types'

/**
 * Desktop Posts table (md and up): the generic DataTable configured for posts.
 * Columns: select · image · title · categories · status · featured · languages
 * (multilingual sites) · updated · published · ends · ⋯. The whole row opens
 * the post; the checkbox, star and ⋯ don't.
 */
export function PostsTable({
  posts,
  multilingual,
  canEdit,
  selected,
  onToggle,
  allState,
  onToggleAll,
  sort,
  onSort,
  onOpen,
  menuFor,
  onFeatured,
}: {
  posts: BrowserPost[]
  multilingual: boolean
  canEdit: boolean
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  allState: 'none' | 'some' | 'all'
  onToggleAll: (checked: boolean) => void
  sort: PostSort
  onSort: (column: SortColumn) => void
  onOpen: (post: BrowserPost, newTab: boolean) => void
  menuFor: (post: BrowserPost) => CardMenuItem[]
  onFeatured: (post: BrowserPost, next: boolean) => Promise<boolean>
}) {
  const t = useTranslations('clientDashboard.posts')
  const current = sortState(sort)

  const columns: DataTableColumn<BrowserPost>[] = [
    {
      key: 'image',
      header: <span className="sr-only">{t('columns.image')}</span>,
      width: 'w-28',
      render: (p) => <CellImage src={p.thumb} />,
    },
    {
      key: 'title',
      header: t('columns.title'),
      sortable: true,
      width: 'min-w-56',
      render: (p) => <CellText primary={p.title} secondary={p.subtitle} href={p.href} />,
    },
    {
      key: 'categories',
      header: t('columns.categories'),
      width: 'w-36',
      render: (p) => <CellChips items={p.categories} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-32',
      render: (p) => (
        <CellPill>
          <StatusPill status={p.status} badge={p.badge} />
        </CellPill>
      ),
    },
    {
      key: 'featured',
      header: (
        <>
          <span className="sr-only">{t('columns.featured')}</span>
          <CellIcon>
            <span aria-hidden="true" className="grid place-items-center">
              {ICONS.starSmall}
            </span>
          </CellIcon>
        </>
      ),
      width: 'w-12',
      render: (p) => (
        <FeaturedStar variant="cell" featured={p.featured} title={p.title} onChange={canEdit ? (next) => onFeatured(p, next) : undefined} />
      ),
    },
    ...(multilingual
      ? [
          {
            key: 'languages',
            header: t('columns.languages'),
            width: 'w-20',
            render: (p: BrowserPost) => <LanguageTicks states={p.languageStates} stacked />,
          },
        ]
      : []),
    {
      key: 'updated',
      header: t('columns.updated'),
      sortable: true,
      width: 'w-28',
      render: (p) => <CellDate iso={p.updatedAt} />,
    },
    {
      key: 'published',
      header: t('columns.published'),
      sortable: true,
      width: 'w-32',
      render: (p) =>
        p.status === 'draft' ? (
          <CellDate iso={null} />
        ) : (
          <CellDate
            iso={p.publishedAt}
            icon={
              p.status === 'scheduled' ? (
                <span role="img" aria-label={t('pill.scheduled')} className="grid place-items-center">
                  {ICONS.clock}
                </span>
              ) : undefined
            }
          />
        ),
    },
    {
      key: 'ends',
      header: t('columns.ends'),
      sortable: true,
      width: 'w-28',
      render: (p) => <CellDate iso={p.expiresAt} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      width: 'w-12',
      render: (p) => (canEdit ? <CardMenu variant="cell" label={t('card.menu', { title: p.title })} items={menuFor(p)} /> : null),
    },
  ]

  return (
    <DataTable
      rows={posts}
      columns={columns}
      rowKey={(p) => p._id}
      selection={
        canEdit
          ? {
              selected,
              onToggle,
              allState,
              onToggleAll,
              rowLabel: (p) => t('select.checkbox', { title: p.title }),
              allLabel: t('columns.selectAll'),
            }
          : undefined
      }
      sort={{ column: current.column, dir: current.dir, onSort: (key) => onSort(key as SortColumn) }}
      rowHref={(p) => p.href}
      onRowClick={onOpen}
    />
  )
}
