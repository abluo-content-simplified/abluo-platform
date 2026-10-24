// ── Events list: categories ───────────────────────────────────────────────────
// ADR-033 Amendment J. Pure helpers behind the Category column, the phone chip
// and the Category filter of the client Events list. No React, no I/O.
//
// Events carry category KEYS; the names come from the project's vocabulary
// (term records, else the old config list — eventCategoryOptions), read once
// for the whole list. Nothing about categories shows while the project has none.

import type { EventCategoryOption } from '@/lib/modules/events/categories'
import { pickerLabel } from '@/components/client/taxonomy/term-picker-model'

/** The Category column and filter show only when the project has at least one event category. */
export function hasEventCategories(options: readonly EventCategoryOption[]): boolean {
  return options.length > 0
}

/**
 * An event's category names, in the vocabulary's order, in the dashboard
 * language (else the site's default language, else any, else the key).
 * A key the vocabulary no longer has is left out, as on the website.
 */
export function eventCategoryNames(keys: readonly string[], options: readonly EventCategoryOption[], ui: string, defaultLocale: string): string[] {
  if (!keys.length) return []
  const own = new Set(keys)
  return options.filter((o) => own.has(o.value)).map((o) => pickerLabel(o, ui, defaultLocale))
}

/** What a cell shows: the first name and how many more ("Yoga +2"). */
export function categorySummary(names: readonly string[]): { first: string | null; more: number } {
  return names.length ? { first: names[0], more: names.length - 1 } : { first: null, more: 0 }
}

/** The filter's choices after "Any category" (value ''), in the vocabulary's order. */
export function eventCategoryFilterOptions(options: readonly EventCategoryOption[], ui: string, defaultLocale: string): { value: string; label: string }[] {
  return options.map((o) => ({ value: o.value, label: pickerLabel(o, ui, defaultLocale) }))
}

/** Whether an event passes the Category filter ('' = any category). */
export function matchesEventCategory(keys: readonly string[], filter: string): boolean {
  return !filter || keys.includes(filter)
}
