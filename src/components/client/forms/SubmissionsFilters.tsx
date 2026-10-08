'use client'

import { useMemo, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListDateValue, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import {
  activeSubmissionFilterCount,
  SUBMISSION_STATUSES,
  type SubmissionFilters,
  type SubmissionStatusFilter,
} from '@/lib/client/submissions-filter'

/**
 * The Forms list's toolbar: the shared ListToolbar configured for contact
 * requests — search first (name, email and everything they sent), then Form
 * and Status selects, the date sentence
 * "Requests [received] [last 7 days] [last 30 days] [this year] [📅]",
 * "N of M requests" (+ summaryExtra) · Clear filters; on phones the filter
 * sheet and the active filters as chips.
 */
export function SubmissionsFilters({
  filters,
  update,
  reset,
  isDefault,
  forms,
  counts,
  resultCount,
  total,
  summaryExtra,
}: {
  filters: SubmissionFilters
  update: (patch: Partial<SubmissionFilters>) => void
  reset: () => void
  isDefault: boolean
  /** The form ids the loaded requests use. */
  forms: string[]
  counts: Record<SubmissionStatusFilter, number>
  resultCount: number
  total: number
  summaryExtra?: ReactNode
}) {
  const t = useTranslations('clientDashboard.submissions')
  const tr = useTranslations('app.ui.dateRange')
  const locale = useLocale()

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }), [locale])
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return dayFmt.format(new Date(y, m - 1, d, 12))
  }

  const selects: ListToolbarFilter[] = []
  if (forms.length > 1) {
    selects.push({
      key: 'form',
      label: t('filters.form'),
      value: filters.form,
      options: [{ value: '', label: t('filters.allForms') }, ...forms.map((f) => ({ value: f, label: f }))],
      onChange: (v) => update({ form: v }),
    })
  }
  selects.push({
    key: 'status',
    label: t('filters.status'),
    value: filters.status,
    options: [
      { value: 'all', label: `${t('filters.allStatuses')} (${counts.all})` },
      ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: `${t(`status.${s}`)} (${counts[s]})` })),
    ],
    onChange: (v) => update({ status: v as SubmissionStatusFilter }),
  })

  const dateValue: ListDateValue = {
    field: 'received',
    preset: filters.from || filters.range === 'all' ? null : filters.range,
    from: filters.from || null,
    to: filters.from ? filters.to || filters.from : null,
  }
  const onDate = (v: ListDateValue) =>
    update({
      range: v.from ? 'all' : (v.preset ?? 'all'),
      from: v.from ?? '',
      to: v.from ? (v.to ?? '') : '',
    })

  const chips: FilterChip[] = []
  if (filters.form) chips.push({ id: 'form', label: filters.form })
  if (filters.status !== 'all') chips.push({ id: 'status', label: t(`status.${filters.status}`) })
  if (filters.from || filters.range !== 'all') {
    const range = filters.from
      ? filters.to && filters.to !== filters.from
        ? `${day(filters.from)} – ${day(filters.to)}`
        : day(filters.from)
      : tr(`inline.${filters.range as 'last7' | 'last30' | 'thisYear'}`)
    chips.push({ id: 'date', label: t('filters.dateChip', { range }) })
  }
  const removeChip = (id: string) => {
    if (id === 'form') update({ form: '' })
    else if (id === 'status') update({ status: 'all' })
    else if (id === 'date') update({ range: 'all', from: '', to: '' })
  }

  return (
    <ListToolbar
      label={t('filters.filters')}
      search={{
        value: filters.q,
        onChange: (q) => update({ q }),
        label: t('filters.searchLabel'),
        placeholder: t('filters.search'),
      }}
      filters={selects}
      date={{
        noun: t('filters.sentenceNoun'),
        label: t('filters.date'),
        fieldLabel: t('filters.dateField'),
        fields: [{ value: 'received', label: t('filters.field_received') }],
        value: dateValue,
        onChange: onDate,
      }}
      summary={t('filters.showing', { shown: resultCount, total })}
      summaryExtra={summaryExtra}
      clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
      sheet={{ activeCount: activeSubmissionFilterCount(filters), resultCount, chips, onRemoveChip: removeChip }}
    />
  )
}
