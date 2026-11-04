'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { useLanguageName } from './person-bits'
import { PERSON_STATES, type PersonFilters, type PersonListState, type PersonSort, type PersonSortColumn, type PersonVisibilityFilter } from '@/lib/client/persons-filter'

const SORTS: PersonSort[] = (['order', 'name', 'updated'] as PersonSortColumn[]).flatMap<PersonSort>((column) =>
  column === 'updated' ? [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }] : [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }]
)
const sortKey = (s: PersonSort) => `${s.column}_${s.dir}`

/**
 * The People list's toolbar: the shared ListToolbar configured for people —
 * search (names, job titles, groups), group, status (archived included),
 * "On the website", sort (cards view and the phone sheet, where there are no
 * column headers) and "N of M people · Clear filters".
 */
export function PeopleFilters({
  filters,
  update,
  reset,
  isDefault,
  counts,
  groups,
  resultCount,
  total,
  activeCount,
  showSortOnDesktop,
  languages = [],
}: {
  filters: PersonFilters
  update: (patch: Partial<PersonFilters>) => void
  reset: () => void
  isDefault: boolean
  counts: Record<PersonListState | 'all', number>
  /** The groups to filter by (key + label), in the vocabulary's order. */
  groups: { value: string; label: string }[]
  resultCount: number
  total: number
  activeCount: number
  showSortOnDesktop: boolean
  /** The site's languages beyond the main one, for "Missing… texts in …". */
  languages?: string[]
}) {
  const t = useTranslations('clientDashboard.persons.list')
  const tl = useTranslations('app.lifecycle')
  const tv = useTranslations('clientDashboard.persons.visibility')
  const languageName = useLanguageName()
  const missingChip = (value: string): string =>
    value === 'photo' ? t('filters.chipPhoto') : value === 'shortBio' ? t('filters.chipShortBio') : t('filters.chipLanguage', { language: languageName(value.slice(5)) })
  const stateLabel = (s: PersonListState) => (s === 'changes' ? tl('pendingChanges') : tl(`status.${s}`))

  const selects: ListToolbarFilter[] = [
    ...(groups.length
      ? [
          {
            key: 'group',
            label: t('filters.group'),
            value: filters.group,
            options: [{ value: 'all', label: t('filters.groupAll') }, ...groups],
            onChange: (v: string) => update({ group: v }),
          },
        ]
      : []),
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [
        { value: 'all', label: `${t('filters.statusAll')} (${counts.all})` },
        ...PERSON_STATES.map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` })),
      ],
      onChange: (v) => update({ status: v as PersonFilters['status'] }),
    },
    {
      key: 'visibility',
      label: t('filters.visibility'),
      value: filters.visibility,
      options: [{ value: 'all', label: t('filters.visibilityAll') }, ...(['listed', 'page', 'off'] as const).map((v) => ({ value: v, label: tv(v) }))],
      onChange: (v) => update({ visibility: v as PersonVisibilityFilter }),
    },
    {
      key: 'missing',
      label: t('filters.missing'),
      value: filters.missing,
      options: [
        { value: 'all', label: t('filters.missingAll') },
        { value: 'photo', label: t('filters.missingPhoto') },
        { value: 'shortBio', label: t('filters.missingShortBio') },
        ...languages.map((l) => ({ value: `lang:${l}`, label: t('filters.missingLanguage', { language: languageName(l) }) })),
      ],
      onChange: (v) => update({ missing: v }),
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
  if (filters.group !== 'all') chips.push({ id: 'group', label: groups.find((g) => g.value === filters.group)?.label ?? filters.group })
  if (filters.status !== 'all') chips.push({ id: 'status', label: stateLabel(filters.status) })
  if (filters.visibility !== 'all') chips.push({ id: 'visibility', label: tv(filters.visibility) })
  if (filters.missing !== 'all') chips.push({ id: 'missing', label: missingChip(filters.missing) })
  const removeChip = (id: string) => {
    if (id === 'group') update({ group: 'all' })
    else if (id === 'status') update({ status: 'all' })
    else if (id === 'visibility') update({ visibility: 'all' })
    else if (id === 'missing') update({ missing: 'all' })
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
