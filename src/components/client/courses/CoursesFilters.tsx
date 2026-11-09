'use client'

import { useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { ANY_COURSE, COURSE_STATES, type CourseFilters, type CourseListState, type CourseSort, type CourseSortColumn } from '@/lib/client/courses-filter'
import { useScheduleFormat } from './schedule-bits'

const SORTS: CourseSort[] = (['updated', 'title'] as CourseSortColumn[]).flatMap<CourseSort>((column) =>
  column === 'updated' ? [{ column, dir: 'desc' as const }, { column, dir: 'asc' as const }] : [{ column, dir: 'asc' as const }, { column, dir: 'desc' as const }]
)
const sortKey = (s: CourseSort) => `${s.column}_${s.dir}`

/** What the select filters can offer: only what the site's courses actually have. */
export type CourseFilterOptions = {
  teachers: Array<{ id: string; name: string }>
  places: Array<{ token: string; name: string }>
  languages: string[]
  days: number[]
  terms: Array<{ id: string; label: string }>
}

/**
 * The Courses list's toolbar: the shared ListToolbar configured for courses —
 * search (titles, descriptions, teachers, places), status (archived
 * included), teacher, place, language, weekday and term (each only when there
 * is something to choose), sort (cards view and the phone sheet, where there
 * are no column headers), "N of M courses", the "Changed this week" toggle
 * and "Clear filters".
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
  options,
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
  options: CourseFilterOptions
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const tl = useTranslations('app.lifecycle')
  const { weekdayName, languageName } = useScheduleFormat()
  const stateLabel = (s: CourseListState) => (s === 'changes' ? tl('pendingChanges') : tl(`status.${s}`))
  const any = (label: string) => ({ value: ANY_COURSE, label })

  const selects: ListToolbarFilter[] = [
    {
      key: 'status',
      label: t('filters.status'),
      value: filters.status,
      options: [{ value: 'all', label: `${t('filters.statusAll')} (${counts.all})` }, ...COURSE_STATES.map((s) => ({ value: s, label: `${stateLabel(s)} (${counts[s]})` }))],
      onChange: (v) => update({ status: v as CourseFilters['status'] }),
    },
  ]
  // A filter shows only when it can narrow the list (or is already set).
  const offer = (n: number, value: string) => n > 1 || value !== ANY_COURSE
  if (offer(options.teachers.length, filters.teacher)) {
    selects.push({ key: 'teacher', label: t('filters.teacher'), value: filters.teacher, options: [any(t('filters.teacherAll')), ...options.teachers.map((p) => ({ value: p.id, label: p.name }))], onChange: (v) => update({ teacher: v }) })
  }
  if (offer(options.places.length, filters.place)) {
    selects.push({ key: 'place', label: t('filters.place'), value: filters.place, options: [any(t('filters.placeAll')), ...options.places.map((p) => ({ value: p.token, label: p.name }))], onChange: (v) => update({ place: v }) })
  }
  if (offer(options.languages.length, filters.language)) {
    selects.push({ key: 'language', label: t('filters.language'), value: filters.language, options: [any(t('filters.languageAll')), ...options.languages.map((l) => ({ value: l, label: languageName(l) }))], onChange: (v) => update({ language: v }) })
  }
  if (offer(options.days.length, filters.day)) {
    selects.push({ key: 'day', label: t('filters.day'), value: filters.day, options: [any(t('filters.dayAll')), ...options.days.map((d) => ({ value: String(d), label: weekdayName(d) }))], onChange: (v) => update({ day: v }) })
  }
  if (offer(options.terms.length, filters.term)) {
    selects.push({ key: 'term', label: t('filters.term'), value: filters.term, options: [any(t('filters.termAll')), ...options.terms.map((x) => ({ value: x.id, label: x.label || x.id }))], onChange: (v) => update({ term: v }) })
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

  const chips: FilterChip[] = []
  if (filters.status !== 'all') chips.push({ id: 'status', label: stateLabel(filters.status) })
  if (filters.teacher !== ANY_COURSE) chips.push({ id: 'teacher', label: options.teachers.find((p) => p.id === filters.teacher)?.name ?? t('filters.teacher') })
  if (filters.place !== ANY_COURSE) chips.push({ id: 'place', label: options.places.find((p) => p.token === filters.place)?.name ?? t('filters.place') })
  if (filters.language !== ANY_COURSE) chips.push({ id: 'language', label: languageName(filters.language) })
  if (filters.day !== ANY_COURSE) chips.push({ id: 'day', label: weekdayName(Number(filters.day)) })
  if (filters.term !== ANY_COURSE) chips.push({ id: 'term', label: options.terms.find((x) => x.id === filters.term)?.label ?? t('filters.term') })
  if (filters.changed) chips.push({ id: 'changed', label: t('filters.changed') })
  if (filters.incomplete) chips.push({ id: 'incomplete', label: t('filters.incomplete') })
  const removeChip = (id: string) => {
    if (id === 'status') update({ status: 'all' })
    else if (id === 'changed') update({ changed: false })
    else if (id === 'incomplete') update({ incomplete: false })
    else update({ [id]: ANY_COURSE } as Partial<CourseFilters>)
  }

  // The two on/off filters, next to the result count (both views, both sizes).
  const toggles = [{ value: 'changed', label: t('filters.changed') }, ...(filters.incomplete ? [{ value: 'incomplete', label: t('filters.incomplete') }] : [])]
  const on = [...(filters.changed ? ['changed'] : []), ...(filters.incomplete ? ['incomplete'] : [])]

  return (
    <ListToolbar
      label={t('filters.label')}
      search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
      filters={selects}
      summary={t('filters.showing', { shown: resultCount, total })}
      summaryExtra={<ToggleChips label={t('filters.toggles')} size="compact" options={toggles} value={on} onChange={(next) => update({ changed: next.includes('changed'), incomplete: next.includes('incomplete') })} />}
      clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
      sheet={{ activeCount, resultCount, chips, onRemoveChip: removeChip }}
    />
  )
}
