'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { useScheduleFormat } from './schedule-bits'
import { ANY, NO_PLACE, activeTimetableFilterCount, isDefaultTimetableFilters, type TimetableFilterOptions, type TimetableFilters } from './timetable-filter'

/**
 * The Timetable's toolbar: the shared ListToolbar configured for classes —
 * search (course, teacher), place, teacher, day, language, "N of M classes ·
 * Clear filters". Options are only what exists in the selected term.
 */
export function TimetableFilters({
  filters,
  update,
  reset,
  options,
  hasUnplaced,
  resultCount,
  total,
}: {
  filters: TimetableFilters
  update: (patch: Partial<TimetableFilters>) => void
  reset: () => void
  options: TimetableFilterOptions
  hasUnplaced: boolean
  resultCount: number
  total: number
}) {
  const t = useTranslations('clientDashboard.courses.timetable.filters')
  const { weekdayName, languageName } = useScheduleFormat()
  const all = (label: string) => ({ value: ANY, label })

  const placeOptions = [all(t('placeAll')), ...options.places.map((p) => ({ value: p.token, label: p.name })), ...(hasUnplaced ? [{ value: NO_PLACE, label: t('noPlace') }] : [])]
  const placeLabel = placeOptions.find((o) => o.value === filters.place)?.label ?? ''

  const selects: ListToolbarFilter[] = [
    { key: 'place', label: t('place'), value: filters.place, options: placeOptions, onChange: (v) => update({ place: v }) },
    {
      key: 'teacher',
      label: t('teacher'),
      value: filters.teacher,
      options: [all(t('teacherAll')), ...options.teachers.map((p) => ({ value: p.id, label: p.name }))],
      onChange: (v) => update({ teacher: v }),
    },
    {
      key: 'day',
      label: t('day'),
      value: filters.day,
      options: [all(t('dayAll')), ...options.days.map((d) => ({ value: String(d), label: weekdayName(d) }))],
      onChange: (v) => update({ day: v }),
    },
    {
      key: 'language',
      label: t('language'),
      value: filters.language,
      options: [all(t('languageAll')), ...options.languages.map((l) => ({ value: l, label: languageName(l) }))],
      onChange: (v) => update({ language: v }),
    },
  ]

  const chips: FilterChip[] = []
  if (filters.place !== ANY) chips.push({ id: 'place', label: placeLabel })
  if (filters.teacher !== ANY) chips.push({ id: 'teacher', label: options.teachers.find((p) => p.id === filters.teacher)?.name ?? '' })
  if (filters.day !== ANY) chips.push({ id: 'day', label: weekdayName(Number(filters.day)) })
  if (filters.language !== ANY) chips.push({ id: 'language', label: languageName(filters.language) })
  const removeChip = (id: string) => update({ [id]: ANY } as Partial<TimetableFilters>)

  return (
    <ListToolbar
      label={t('label')}
      search={{ value: filters.q, onChange: (q) => update({ q }), label: t('search'), placeholder: t('searchPlaceholder') }}
      filters={selects}
      summary={t('showing', { shown: resultCount, total })}
      clear={{ label: t('clear'), onClear: reset, visible: !isDefaultTimetableFilters(filters) }}
      sheet={{ activeCount: activeTimetableFilterCount(filters), resultCount, chips, onRemoveChip: removeChip }}
    />
  )
}
