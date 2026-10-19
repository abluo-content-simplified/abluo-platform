'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { FAQ_SET_STATES, type FaqSetFilters, type FaqSetListState, type FaqSort, type FaqSortColumn, type FaqUsageFilter } from '@/lib/client/faq-sets-filter'

const SORTS: FaqSort[] = (['updated', 'name', 'questions'] as FaqSortColumn[]).flatMap<FaqSort>((column) =>
  column === 'name' ? [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }] : [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }]
)
const sortKey = (s: FaqSort) => `${s.column}_${s.dir}`

/**
 * The FAQ Sets list's toolbar: the shared ListToolbar configured for FAQ sets
 * — search (names and questions, every language), status, where used, sort
 * (cards view and the phone sheet, where there are no column headers) and
 * "N of M FAQ sets · Clear filters".
 */
export function FaqSetsFilters({
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
  filters: FaqSetFilters
  update: (patch: Partial<FaqSetFilters>) => void
  reset: () => void
  isDefault: boolean
  counts: Record<FaqSetListState | 'all', number>
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
}) {
  const t = useTranslations('clientDashboard.faq.list')
  const tl = useTranslations('app.lifecycle')
  const stateLabel = (s: FaqSetListState) => (s === 'changes' ? tl('pendingChanges') : tl(`status.${s}`))

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [
        { value: 'all', label: `${t('filters.statusAll')} (${counts.all})` },
        ...FAQ_SET_STATES.map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` })),
      ],
      onChange: (v) => update({ status: v as FaqSetFilters['status'] }),
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
      onChange: (v) => update({ usage: v as FaqUsageFilter }),
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
  if (filters.usage !== 'all') chips.push({ id: 'usage', label: t(filters.usage === 'used' ? 'filters.usageUsed' : 'filters.usageUnused') })
  const removeChip = (id: string) => {
    if (id === 'status') update({ status: 'all' })
    else if (id === 'usage') update({ usage: 'all' })
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
