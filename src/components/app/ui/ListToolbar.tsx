'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { FilterSearch, FilterSelect, type FilterOption } from './FilterBar'
import { AppliedFilterChips, FilterSheet, type FilterChip } from './FilterSheet'
import { DateRangePicker } from './DateRangePicker'
import type { RangePreset } from '@/lib/client/date-range'

/**
 * The shared toolbar under an Abluo App list page's header (posts, events,
 * journal, galleries, forms …). Configured entirely by props; it knows
 * nothing about any one content type.
 *
 * Computers (md+), three lines, the controls on each line vertically centred:
 *   A. search (flex-1, min 16rem) · the page's select filters, all the same
 *      fixed width (`filterWidth`, long labels truncate). Wraps only when the
 *      window really can't fit it.
 *   B. the date sentence: "Posts [updated ▾] [last 7 days] [last 30 days] [this year] [📅]"
 *   C. "N of M posts" (+ summaryExtra) · Clear filters
 * Phones: search, a "Filters · N" sheet with the same filters and the date
 * sentence stacked, the active filters as removable chips, then line C.
 *
 *   <ListToolbar
 *     search={{ value: q, onChange: setQ, placeholder: 'Search events…' }}
 *     filters={[{ key: 'status', label: 'Status', value, options, onChange }]}
 *     date={{ noun: 'Events', label: 'Date', fields, value, onChange }}
 *     summary="3 of 12 events"
 *     clear={{ label: 'Clear filters', onClear: reset, visible: !isDefault }}
 *     sheet={{ activeCount, resultCount, chips, onRemoveChip }}
 *   />
 */

export type ListToolbarFilter = {
  key: string
  /** Accessible name (the select shows its options only). */
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  /** Where it shows: everywhere (default), computers only or the phone sheet only. */
  placement?: 'all' | 'desktop' | 'sheet'
}

/** The date sentence's state: which date, and a quick range or a custom one (ISO days). */
export type ListDateValue = {
  field: string
  preset: RangePreset | null
  from: string | null
  to: string | null
}

export type ListToolbarDate = {
  /** The page's noun, starting the sentence ("Posts", "Events"). */
  noun: string
  /** Accessible name of the whole date group ("Date"). */
  label: string
  /** Accessible name of the which-date select ("Which date"). */
  fieldLabel: string
  /** Which date, lower-case as in a sentence ("updated", "published", "ends"). */
  fields: FilterOption[]
  value: ListDateValue
  onChange: (value: ListDateValue) => void
  /** Quick ranges, as toggle chips. Default: last 7 days, last 30 days, this year. */
  presets?: RangePreset[]
}

const SENTENCE_TEXT = 'shrink-0 text-[0.9375rem] leading-6 font-medium text-foreground'
const FIELD_SELECT =
  'h-11 w-full truncate rounded-xl border border-border bg-background px-3 text-[0.9375rem] leading-6 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function ListToolbar({
  label,
  search,
  filters = [],
  date,
  summary,
  summaryExtra,
  clear,
  sheet,
  filterWidth = 'w-[11rem]',
  dateFieldWidth = 'w-[8.5rem]',
}: {
  /** Accessible name of the filters group. */
  label?: string
  search: { value: string; onChange: (value: string) => void; placeholder: string; label?: string }
  filters?: ListToolbarFilter[]
  date?: ListToolbarDate
  /** "N of M posts" (live region). */
  summary: ReactNode
  /** Next to the summary, e.g. a select-all checkbox. */
  summaryExtra?: ReactNode
  /** "Clear filters": resets to the page's defaults. Hidden while nothing differs from them. */
  clear: { label: string; onClear: () => void; visible: boolean }
  /** Phones: the sheet trigger's count and the chips shown while it is closed. */
  sheet: { activeCount: number; resultCount: number; chips: FilterChip[]; onRemoveChip: (id: string) => void }
  /** The one fixed width of every filter select on computers (not content-sized, so nothing jumps). */
  filterWidth?: string
  /** The fixed width of the which-date select in the date sentence. */
  dateFieldWidth?: string
}) {
  const t = useTranslations('app.ui.dateRange')

  const selects = (inSheet: boolean) =>
    filters
      .filter((f) => (f.placement ?? 'all') === 'all' || f.placement === (inSheet ? 'sheet' : 'desktop'))
      .map((f) => (
        <FilterSelect
          key={f.key}
          label={f.label}
          value={f.value}
          onChange={f.onChange}
          options={f.options}
          sizing={inSheet ? 'w-full' : `${filterWidth} shrink-0`}
        />
      ))

  const sentence = (inSheet: boolean) =>
    date ? (
      <div role="group" aria-label={date.label} className="flex flex-wrap items-center gap-2">
        <span className={SENTENCE_TEXT}>{date.noun}</span>
        <label className={`block shrink-0 ${dateFieldWidth}`}>
          <span className="sr-only">{date.fieldLabel}</span>
          <select
            value={date.value.field}
            onChange={(e) => date.onChange({ ...date.value, field: e.target.value })}
            className={FIELD_SELECT}
          >
            {date.fields.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <DateRangePicker
          label={date.label}
          presets={date.presets ?? ['last7', 'last30', 'thisYear']}
          preset={date.value.preset}
          onPresetChange={(preset) => date.onChange({ ...date.value, preset, from: null, to: null })}
          presetLabel={(p) => t(`inline.${p}`)}
          value={{ from: date.value.from, to: date.value.to }}
          onChange={(r) => date.onChange({ ...date.value, preset: null, from: r.from, to: r.to })}
          className={inSheet ? 'w-full' : ''}
        />
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-3">
      {/* Computers */}
      <div role="group" aria-label={label} className="hidden flex-col gap-3 md:flex">
        {/* Line A: search + the filter selects, one line */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSearch
            value={search.value}
            onChange={search.onChange}
            label={search.label}
            placeholder={search.placeholder}
            sizing="min-w-[16rem] flex-1"
          />
          {selects(false)}
        </div>
        {/* Line B: the date sentence */}
        {sentence(false)}
      </div>

      {/* Phones */}
      <div className="flex flex-col items-stretch gap-2 md:hidden">
        <FilterSearch value={search.value} onChange={search.onChange} label={search.label} placeholder={search.placeholder} />
        <FilterSheet activeCount={sheet.activeCount} resultCount={sheet.resultCount} onClearAll={clear.onClear}>
          {selects(true)}
          {sentence(true)}
        </FilterSheet>
        <AppliedFilterChips chips={sheet.chips} onRemove={sheet.onRemoveChip} onClearAll={clear.onClear} />
      </div>

      {/* Line C: "N of M posts" · Clear filters */}
      <div className="flex min-h-11 items-center justify-between gap-3 text-sm leading-5 text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <p aria-live="polite">{summary}</p>
          {summaryExtra}
        </div>
        {clear.visible ? (
          <button
            type="button"
            onClick={clear.onClear}
            className="inline-flex min-h-11 shrink-0 items-center font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {clear.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}
