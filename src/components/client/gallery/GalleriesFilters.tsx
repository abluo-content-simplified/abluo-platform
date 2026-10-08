'use client'

import { useMemo, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListDateValue, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import {
  GALLERY_STATES,
  type GalleryDateField,
  type GalleryFilters,
  type GallerySort,
  type GallerySortColumn,
  type GalleryState,
  type GalleryUsageFilter,
} from '@/lib/client/galleries-filter'

const SORTS: GallerySort[] = (['updated', 'created', 'title', 'photos'] as GallerySortColumn[]).flatMap<GallerySort>((column) =>
  column === 'title'
    ? [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }]
    : [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }]
)
const sortKey = (s: GallerySort) => `${s.column}_${s.dir}`

/**
 * The Galleries list's toolbar: the shared ListToolbar configured for
 * galleries — search (title, internal name, tags), status, where used, tag
 * (when galleries have tags), sort (grid view and the phone sheet, where there
 * are no column headers), the date sentence
 * "Galleries [updated ▾] [last 7 days] [last 30 days] [this year] [📅]" and
 * "N of M galleries · Clear filters".
 */
export function GalleriesFilters({
  filters,
  update,
  reset,
  isDefault,
  tags,
  counts,
  resultCount,
  total,
  activeCount,
  showSortOnDesktop,
  summaryExtra,
}: {
  filters: GalleryFilters
  update: (patch: Partial<GalleryFilters>) => void
  reset: () => void
  isDefault: boolean
  /** Tags the galleries use (the tag filter shows only when there are some). */
  tags: string[]
  counts: Record<GalleryState | 'all', number>
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
  summaryExtra?: ReactNode
}) {
  const t = useTranslations('clientDashboard.gallery.list')
  const tr = useTranslations('app.ui.dateRange')
  const locale = useLocale()
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }), [locale])
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return dayFmt.format(new Date(y, m - 1, d, 12))
  }

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [
        { value: 'all', label: `${t('filters.statusAll')} (${counts.all})` },
        ...GALLERY_STATES.map((s) => ({ value: s, label: `${t(`state.${s}`)} (${counts[s]})` })),
      ],
      onChange: (v) => update({ status: v as GalleryFilters['status'] }),
    },
    {
      key: 'usage',
      label: t('filters.usage'),
      value: filters.usage,
      options: [
        { value: 'all', label: t('filters.usageAny') },
        { value: 'used', label: t('filters.usageUsed') },
        { value: 'unused', label: t('filters.usageUnused') },
      ],
      onChange: (v) => update({ usage: v as GalleryUsageFilter }),
    },
  ]
  if (tags.length > 0) {
    selects.push({
      key: 'tag',
      label: t('filters.tag'),
      value: filters.tag,
      options: [{ value: '', label: t('filters.allTags') }, ...tags.map((x) => ({ value: x, label: x }))],
      onChange: (v) => update({ tag: v }),
    })
  }
  selects.push({
    key: 'sort',
    label: t('filters.sort'),
    value: sortKey(filters.sort),
    options: SORTS.map((s) => ({ value: sortKey(s), label: t(`filters.sort_${sortKey(s)}`) })),
    onChange: (v) => {
      const s = SORTS.find((x) => sortKey(x) === v)
      if (s) update({ sort: s })
    },
    placement: showSortOnDesktop ? 'all' : 'sheet',
  })

  const dateValue: ListDateValue = {
    field: filters.dateField,
    preset: filters.from || filters.range === 'all' ? null : filters.range,
    from: filters.from || null,
    to: filters.from ? filters.to || filters.from : null,
  }
  const onDate = (v: ListDateValue) =>
    update({ dateField: v.field as GalleryDateField, range: v.from ? 'all' : (v.preset ?? 'all'), from: v.from ?? '', to: v.from ? (v.to ?? '') : '' })

  const chips: FilterChip[] = []
  if (filters.status !== 'all') chips.push({ id: 'status', label: t(`state.${filters.status}`) })
  if (filters.usage !== 'all') chips.push({ id: 'usage', label: t(filters.usage === 'used' ? 'filters.usageUsed' : 'filters.usageUnused') })
  if (filters.tag) chips.push({ id: 'tag', label: filters.tag })
  if (filters.from || filters.range !== 'all') {
    const range = filters.from
      ? filters.to && filters.to !== filters.from
        ? `${day(filters.from)} – ${day(filters.to)}`
        : day(filters.from)
      : tr(`inline.${filters.range as 'last7' | 'last30' | 'thisYear'}`)
    chips.push({ id: 'date', label: t('filters.dateChip', { field: t(`filters.sentenceField_${filters.dateField}`), range }) })
  }
  const removeChip = (id: string) => {
    if (id === 'status') update({ status: 'all' })
    else if (id === 'usage') update({ usage: 'all' })
    else if (id === 'tag') update({ tag: '' })
    else if (id === 'date') update({ range: 'all', from: '', to: '' })
  }

  return (
    <ListToolbar
      label={t('filters.label')}
      search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
      filters={selects}
      date={{
        noun: t('filters.sentenceNoun'),
        label: t('filters.date'),
        fieldLabel: t('filters.dateField'),
        fields: (['updated', 'created'] as GalleryDateField[]).map((d) => ({ value: d, label: t(`filters.sentenceField_${d}`) })),
        value: dateValue,
        onChange: onDate,
      }}
      summary={t('filters.showing', { shown: resultCount, total })}
      summaryExtra={summaryExtra}
      clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
      sheet={{ activeCount, resultCount, chips, onRemoveChip: removeChip }}
    />
  )
}
