'use client'

// Timetable filters: language, teacher, location and class. One "Filters"
// button (with the number of active filters) opens the site's dialog — a
// bottom sheet on phones — where every filter is a row of choice chips. On
// computers the active filters also show as removable chips under the
// toolbar. A filter with fewer than two options is not shown (unless it is the
// active choice, so it can be cleared).

import { useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { SiteDialog } from '@/components/site/SiteDialog'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { activeFilterCount, NO_FILTERS, type FilterOption, type Filters } from './filters'
import { languageName } from './format'

export type FilterChoices = { languages: string[]; teachers: FilterOption[]; places: FilterOption[]; courses: FilterOption[] }

type Props = {
  filters: Filters
  onChange: (next: Filters) => void
  choices: FilterChoices
  locale: string
  msg: TimetableMessages
}

const BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--color-text-primary)_6%,transparent)] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]'
const BUTTON_STYLE = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' } as const

type Group = { key: keyof Filters; label: string; all: string; options: FilterOption[] }

function groupsOf({ filters, choices, locale, msg }: Omit<Props, 'onChange'>): Group[] {
  const show = (n: number, current: string | null) => n >= 2 || !!current
  const out: Group[] = []
  if (show(choices.languages.length, filters.language)) out.push({ key: 'language', label: msg.languageFilter, all: msg.allLanguages, options: choices.languages.map((l) => ({ value: l, label: languageName(locale, l) })) })
  if (show(choices.teachers.length, filters.teacher)) out.push({ key: 'teacher', label: msg.teacherFilter, all: msg.allTeachers, options: choices.teachers })
  if (show(choices.places.length, filters.place)) out.push({ key: 'place', label: msg.locationFilter, all: msg.allLocations, options: choices.places })
  if (show(choices.courses.length, filters.course)) out.push({ key: 'course', label: msg.courseFilter, all: msg.allCourses, options: choices.courses })
  return out
}

/** A choice chip: soft when idle, filled with the primary colour when chosen. */
function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="inline-flex min-h-9 items-center px-3.5 text-sm font-medium transition-[background-color,color,border-color] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      style={{
        borderRadius: 'var(--radius-btn)',
        border: '1px solid',
        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface))' : 'var(--color-surface)',
        color: 'var(--color-text-primary)',
      }}
    >
      {children}
    </button>
  )
}

function Groups(props: Props) {
  const { filters, onChange } = props
  return (
    <>
      {groupsOf(props).map((g) => (
        <fieldset key={g.key} className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-muted)' }}>
            {g.label}
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={g.label}>
            <ChoiceChip selected={!filters[g.key]} onClick={() => onChange({ ...filters, [g.key]: null })}>
              {g.all}
            </ChoiceChip>
            {g.options.map((o) => (
              <ChoiceChip key={o.value} selected={filters[g.key] === o.value} onClick={() => onChange({ ...filters, [g.key]: filters[g.key] === o.value ? null : o.value })}>
                {o.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      ))}
    </>
  )
}

/** Which filters are worth showing at all. */
export function hasFilterChoices(filters: Filters, c: FilterChoices): boolean {
  return (c.languages.length >= 2 || !!filters.language) || (c.teachers.length >= 2 || !!filters.teacher) || (c.places.length >= 2 || !!filters.place) || (c.courses.length >= 2 || !!filters.course)
}

/** The "Filters" button and its dialog. `compact` = the phone header's icon-sized button. */
export function FilterBar(props: Props & { compact?: boolean }) {
  const { filters, onChange, choices, msg, compact = false } = props
  const [open, setOpen] = useState(false)
  if (!hasFilterChoices(filters, choices)) return null
  const count = activeFilterCount(filters)
  return (
    <>
      <button
        type="button"
        className={compact ? BUTTON.replace('h-10', 'h-9').replace('px-4', 'min-w-9 px-2.5') : BUTTON}
        style={count > 0 ? { ...BUTTON_STYLE, borderColor: 'var(--color-primary)' } : BUTTON_STYLE}
        onClick={() => setOpen(true)}
        data-filters-button
      >
        <SlidersHorizontal aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
        <span className={compact ? 'sr-only' : undefined}>{msg.filters}</span>
        {count > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center px-1 text-[11px] font-semibold" style={{ borderRadius: 'var(--radius-btn)', backgroundColor: 'var(--color-primary)', color: 'var(--btn-primary-text, var(--color-background))' }}>
            {count}
          </span>
        )}
      </button>
      <SiteDialog isOpen={open} onClose={() => setOpen(false)} closeLabel={msg.close} closeOnBackdrop variant="sheet" title={msg.filters}>
        <div className="flex flex-col gap-6 pb-2" data-filters="sheet">
          <Groups {...props} />
          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" className={BUTTON} style={BUTTON_STYLE} disabled={count === 0} onClick={() => onChange(NO_FILTERS)}>
              {msg.resetFilters}
            </button>
            <button type="button" className={BUTTON} style={{ ...BUTTON_STYLE, backgroundColor: 'var(--btn-primary-bg, var(--color-primary))', borderColor: 'var(--btn-primary-bg, var(--color-primary))', color: 'var(--btn-primary-text, var(--color-background))' }} onClick={() => setOpen(false)}>
              {msg.done}
            </button>
          </div>
        </div>
      </SiteDialog>
    </>
  )
}

/** The active filters as removable chips (computers, under the toolbar). Nothing when no filter is on. */
export function ActiveFilters({ className = '', ...props }: Props & { className?: string }) {
  const { filters, onChange, msg } = props
  const active = groupsOf(props).flatMap((g) => {
    const v = filters[g.key]
    if (!v) return []
    const label = g.options.find((o) => o.value === v)?.label ?? v
    return [{ key: g.key, label: `${g.label}: ${label}` }]
  })
  if (active.length === 0) return null
  return (
    <div className={`-mt-2 mb-6 flex flex-wrap items-center gap-2 ${className}`} data-filters="active">
      {active.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onChange({ ...filters, [a.key]: null })}
          className="inline-flex h-8 items-center gap-1.5 pl-3 pr-2 text-sm font-medium"
          style={{ borderRadius: 'var(--radius-btn)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface))', color: 'var(--color-text-primary)' }}
          aria-label={`${a.label} — ${msg.resetFilters}`}
        >
          {a.label}
          <X aria-hidden="true" width={14} height={14} strokeWidth={2} />
        </button>
      ))}
      <button type="button" className="h-8 px-2 text-sm underline underline-offset-2" style={{ color: 'var(--color-text-secondary)' }} onClick={() => onChange(NO_FILTERS)}>
        {msg.resetFilters}
      </button>
    </div>
  )
}
