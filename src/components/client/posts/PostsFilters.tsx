'use client'

import { useMemo, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FilterOption } from '@/components/app/ui/FilterBar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListDateValue, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { DateField, PostFilters, PostSort, PostStatus } from '@/lib/client/posts-filter'

const STATUSES: PostStatus[] = ['published', 'scheduled', 'draft', 'offline']
const SORTS: PostSort[] = ['newest', 'oldest', 'edited', 'edited_asc', 'title', 'title_desc', 'ends', 'ends_desc']
const DATE_FIELDS: DateField[] = ['updated', 'published', 'ends']

/**
 * The Posts list's toolbar: the shared ListToolbar configured for posts —
 * search (titles, subtitles and body text, every language), category, status,
 * translations and featured selects (plus sort in the cards view and the
 * phone sheet, where there are no column headers), the date sentence
 * "Posts [updated ▾] [last 7 days] [last 30 days] [this year] [📅]" and
 * "N of M posts · Clear filters".
 */
export function PostsFilters({
  filters,
  update,
  reset,
  isDefault,
  categories,
  multilingual,
  counts,
  resultCount,
  total,
  activeCount,
  showSortOnDesktop,
  summaryExtra,
}: {
  filters: PostFilters
  update: (patch: Partial<PostFilters>) => void
  reset: () => void
  /** Nothing differs from the page-load filters: hide "Clear filters". */
  isDefault: boolean
  /** Only the categories posts actually use. */
  categories: { value: string; label: string }[]
  /** Two or more site languages: show the translations filter. */
  multilingual: boolean
  counts: Record<PostStatus | 'all', number>
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
  summaryExtra?: ReactNode
}) {
  const t = useTranslations('clientDashboard.posts')
  const tr = useTranslations('app.ui.dateRange')
  const locale = useLocale()

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }), [locale])
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return dayFmt.format(new Date(y, m - 1, d, 12))
  }

  const selects: ListToolbarFilter[] = []
  if (categories.length > 0) {
    selects.push({
      key: 'category',
      label: t('filters.category'),
      value: filters.categories.length === 1 ? filters.categories[0] : '',
      options: [{ value: '', label: t('filters.categoryAll') }, ...categories],
      onChange: (v) => update({ categories: v ? [v] : [] }),
    })
  }
  selects.push({
    key: 'status',
    label: t('filters.status'),
    value: filters.status,
    options: [
      { value: 'all', label: `${t('filters.statusAll')} (${counts.all})` },
      ...STATUSES.map((s) => ({ value: s, label: `${t(`pill.${s}`)} (${counts[s]})` })),
    ],
    onChange: (v) => update({ status: v as PostFilters['status'] }),
  })
  if (multilingual) {
    selects.push({
      key: 'translations',
      label: t('filters.translations'),
      value: filters.translations,
      options: [
        { value: '', label: t('filters.translationsAll') },
        { value: 'complete', label: t('filters.translationsComplete') },
        { value: 'missing', label: t('filters.translationsMissing') },
      ],
      onChange: (v) => update({ translations: v as PostFilters['translations'], missing: '' }),
    })
  }
  selects.push({
    key: 'featured',
    label: t('filters.featured'),
    value: filters.featured,
    options: [
      { value: '', label: t('filters.featuredAll') },
      { value: 'yes', label: t('filters.featuredOnly') },
    ],
    onChange: (v) => update({ featured: v as PostFilters['featured'] }),
  })
  selects.push({
    key: 'sort',
    label: t('filters.sort'),
    value: filters.sort,
    options: SORTS.map((s) => ({ value: s, label: t(`filters.sort_${s}`) })),
    onChange: (v) => update({ sort: v as PostSort }),
    placement: showSortOnDesktop ? 'all' : 'sheet',
  })

  const dateFields: FilterOption[] = DATE_FIELDS.map((d) => ({ value: d, label: t(`filters.sentenceField_${d}`) }))
  const dateValue: ListDateValue = {
    field: filters.dateField,
    preset: filters.from || filters.range === 'all' ? null : filters.range,
    from: filters.from || null,
    to: filters.from ? filters.to || filters.from : null,
  }
  const onDate = (v: ListDateValue) =>
    update({
      dateField: v.field as DateField,
      range: v.from ? 'all' : (v.preset ?? 'all'),
      from: v.from ?? '',
      to: v.from ? (v.to ?? '') : '',
      when: 'all',
    })

  // Active filters as removable chips (phones, while the sheet is closed).
  const chips: FilterChip[] = []
  if (filters.status !== 'all') chips.push({ id: 'status', label: t(`pill.${filters.status}`) })
  for (const c of filters.categories) chips.push({ id: `cat:${c}`, label: categories.find((x) => x.value === c)?.label ?? c })
  if (filters.translations) chips.push({ id: 'translations', label: t(filters.translations === 'complete' ? 'filters.translationsComplete' : 'filters.translationsMissing') })
  if (filters.missing) chips.push({ id: 'missing', label: t('filters.missingLanguage', { language: filters.missing.toUpperCase() }) })
  if (filters.featured) chips.push({ id: 'featured', label: t('filters.featuredOnly') })
  if (filters.when !== 'all') chips.push({ id: 'when', label: t('filters.date') })
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
    else if (id.startsWith('cat:')) update({ categories: filters.categories.filter((c) => `cat:${c}` !== id) })
    else if (id === 'translations') update({ translations: '' })
    else if (id === 'missing') update({ missing: '' })
    else if (id === 'featured') update({ featured: '' })
    else if (id === 'when') update({ when: 'all' })
    else if (id === 'date') update({ range: 'all', from: '', to: '' })
  }

  return (
    <ListToolbar
      label={t('filters.filters')}
      search={{
        value: filters.q,
        onChange: (q) => update({ q }),
        label: t('filters.search'),
        placeholder: t('filters.searchPlaceholder'),
      }}
      filters={selects}
      date={{
        noun: t('filters.sentenceNoun'),
        label: t('filters.date'),
        fieldLabel: t('filters.dateField'),
        fields: dateFields,
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
