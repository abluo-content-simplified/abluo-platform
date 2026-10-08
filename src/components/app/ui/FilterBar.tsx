'use client'

import type { ChangeEvent, ReactNode } from 'react'
import { useTranslations } from 'next-intl'

/**
 * One shared filter bar for the Abluo App lists. Every control is
 * 2.75rem tall with the same border, radius, background, font size and
 * padding, vertically centred on one row. On phones it wraps into rows with the
 * search full-width first; from `sm` up the controls sit side by side.
 *
 *   <FilterBar label="Filters">
 *     <FilterSearch value={q} onChange={setQ} placeholder="Search…" />
 *     <FilterSelect label="Status" value={s} onChange={setS} options={[{ value: 'all', label: 'All' }]} />
 *     <FilterDate label="From" value={d} onChange={setD} />
 *     <FilterSegmented label="Sort" value={sort} onChange={setSort} options={[…]} />
 *   </FilterBar>
 */

const CONTROL =
  'h-11 w-full rounded-xl border border-border bg-background px-3 text-[0.9375rem] leading-6 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function FilterBar({ label, children }: { label?: string; children: ReactNode }) {
  const t = useTranslations('app.filterBar')
  return (
    <div role="group" aria-label={label ?? t('label')} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  )
}

export type FilterOption = { value: string; label: string }

export function FilterSearch({
  value,
  onChange,
  placeholder,
  label,
  sizing = 'w-full min-w-0 sm:w-auto sm:min-w-56 sm:flex-1',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  /** Width / flex classes (replaces the default). */
  sizing?: string
  className?: string
}) {
  const t = useTranslations('app.filterBar')
  return (
    <label className={`relative order-first block ${sizing} ${className}`}>
      <span className="sr-only">{label ?? t('search')}</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={`${CONTROL} pl-10`}
      />
    </label>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  sizing = 'min-w-[calc(50%-0.25rem)] flex-1 sm:w-auto sm:min-w-40 sm:flex-none',
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  /** Width / flex classes (replaces the default), e.g. a fixed `w-[11rem] shrink-0`. */
  sizing?: string
  className?: string
}) {
  return (
    <label className={`block ${sizing} ${className}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${CONTROL} truncate`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function FilterDate({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={`block min-w-[calc(50%-0.25rem)] flex-1 sm:w-auto sm:min-w-40 sm:flex-none ${className}`}>
      <span className="sr-only">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL} />
    </label>
  )
}

export function FilterSegmented({
  label,
  value,
  onChange,
  options,
  className = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`flex h-11 w-full items-stretch gap-1 rounded-xl border border-border bg-background p-1 sm:w-auto ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            value === o.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
