'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import {
  TESTIMONIAL_STATES,
  type TestimonialFilters,
  type TestimonialListState,
  type TestimonialSort,
  type TestimonialSortColumn,
} from '@/lib/client/testimonials-filter'

const SORTS: TestimonialSort[] = (['updated', 'name', 'rating'] as TestimonialSortColumn[]).flatMap<TestimonialSort>((column) =>
  column === 'name' ? [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }] : [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }]
)
const sortKey = (s: TestimonialSort) => `${s.column}_${s.dir}`

/**
 * The Testimonials list's toolbar: the shared ListToolbar configured for
 * testimonials — search (names and texts, every language), status, sort (cards
 * view and the phone sheet, where there are no column headers) and
 * "N of M testimonials · Clear filters".
 */
export function TestimonialsFilters({
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
  filters: TestimonialFilters
  update: (patch: Partial<TestimonialFilters>) => void
  reset: () => void
  isDefault: boolean
  counts: Record<TestimonialListState | 'all', number>
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
}) {
  const t = useTranslations('clientDashboard.testimonials.list')
  const tl = useTranslations('app.lifecycle')
  const stateLabel = (s: TestimonialListState) => (s === 'changes' ? tl('pendingChanges') : tl(`status.${s}`))

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [
        { value: 'all', label: `${t('filters.statusAll')} (${counts.all})` },
        ...TESTIMONIAL_STATES.filter((s) => s !== 'scheduled' || counts.scheduled > 0).map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` })),
      ],
      onChange: (v) => update({ status: v as TestimonialFilters['status'] }),
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
