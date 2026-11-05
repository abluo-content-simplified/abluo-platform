'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { COURSE_STATES, type CourseFilters, type CourseListState, type CourseSort, type CourseSortColumn } from '@/lib/client/courses-filter'

const SORTS: CourseSort[] = (['updated', 'title'] as CourseSortColumn[]).flatMap<CourseSort>((column) =>
  column === 'updated' ? [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }] : [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }]
)
const sortKey = (s: CourseSort) => `${s.column}_${s.dir}`

/**
 * The Courses list's toolbar: the shared ListToolbar configured for courses —
 * search (titles, descriptions, teachers), status (archived included), sort
 * (cards view and the phone sheet, where there are no column headers) and
 * "N of M courses · Clear filters".
 */
export function CoursesFilters({
  filters,
  update,
  reset,
  isDefault,
  counts,
  resultCount,
  total,
  activeCount,
  showSortOnDesktop,
}: {
  filters: CourseFilters
  update: (patch: Partial<CourseFilters>) => void
  reset: () => void
  isDefault: boolean
  counts: Record<CourseListState | 'all', number>
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const tl = useTranslations('app.lifecycle')
  const stateLabel = (s: CourseListState) => (s === 'changes' ? tl('pendingChanges') : tl(`status.${s}`))

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [{ value: 'all', label: `${t('filters.statusAll')} (${counts.all})` }, ...COURSE_STATES.map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` }))],
      onChange: (v) => update({ status: v as CourseFilters['status'] }),
    },
    {
      key: 'sort',
      label: t('filters.sort'),
      value: sortKey(filters.sort),
      options: SORTS.map((s) => ({ value: sortKey(s), label: t(`filters.sort_${sortKey(s)}`) })),
      onChange: (v) => {
        const s = SORTS.find((x) => sortKey(x) === v)
        if (s) update({ sort: s })
      },
      placement: showSortOnDesktop ? 'all' : 'sheet',
    },
  ]

  const chips: FilterChip[] = []
  if (filters.status !== 'all') chips.push({ id: 'status', label: stateLabel(filters.status) })
  const removeChip = (id: string) => {
    if (id === 'status') update({ status: 'all' })
  }

  return (
    <ListToolbar
      label={t('filters.label')}
      search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
      filters={selects}
      summary={t('filters.showing', { shown: resultCount, total })}
      clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
      sheet={{ activeCount, resultCount, chips, onRemoveChip: removeChip }}
    />
  )
}
