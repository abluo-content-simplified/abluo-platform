// ── TermPicker model ──────────────────────────────────────────────────────────
// ADR-033 Amendment J, slice 5. Pure helpers behind the shared TermPicker:
// merging terms created on the spot into the list, the label to show, search,
// keeping the selection in list order, and the label a new term is created with.
// No React, no I/O (vitest runs in node).

import { cleanText } from './taxonomy-view'
import { websiteLabel } from '@/lib/tag-text'

/** One selectable term: stable key, label per language, optional colour. */
export type PickerTerm = { value: string; label: Record<string, string>; color: string | null }

/** The shape the taxonomy service returns for a term (only what the picker needs). */
export type PickerTermSource = { key: string; label: Record<string, string>; color?: string | null }

export const toPickerTerm = (term: PickerTermSource): PickerTerm => ({ value: term.key, label: term.label, color: term.color ?? null })

/** Label in the dashboard language, else the project's default language, else any, else the key. */
export function pickerLabel(term: PickerTerm, ui: string, defaultLocale: string): string {
  const v = term.label ?? {}
  return v[ui]?.trim() || v[defaultLocale]?.trim() || Object.values(v).find((s) => s?.trim()) || term.value
}

/**
 * The list shown: the terms the page loaded, in their order, then terms created
 * here that the page does not know yet. A page refresh that now includes a term
 * wins over the local copy (no duplicate).
 */
export function mergeTerms(base: readonly PickerTerm[], added: readonly PickerTerm[]): PickerTerm[] {
  const seen = new Set(base.map((t) => t.value))
  const out = [...base]
  for (const t of added) {
    if (seen.has(t.value)) continue
    seen.add(t.value)
    out.push(t)
  }
  return out
}

/** Lower-cased, accent-free, whitespace-collapsed text for matching. */
export function foldText(value: string): string {
  return cleanText(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Search: terms whose label (in any language) or key contains the text. An empty
 * search keeps everything. Chosen terms always stay visible, so a search never
 * hides what is already selected.
 */
export function filterTerms(terms: readonly PickerTerm[], query: string, selected: readonly string[] = []): PickerTerm[] {
  const q = foldText(query)
  if (!q) return [...terms]
  const chosen = new Set(selected)
  return terms.filter((t) => chosen.has(t.value) || t.value.toLowerCase().includes(q) || Object.values(t.label ?? {}).some((l) => foldText(l ?? '').includes(q)))
}

/** The existing term whose label (shown language, default language, or any) equals the text, ignoring case and accents. */
export function findByLabel(terms: readonly PickerTerm[], text: string, ui: string, defaultLocale: string): PickerTerm | null {
  const q = foldText(text)
  if (!q) return null
  return (
    terms.find((t) => foldText(pickerLabel(t, ui, defaultLocale)) === q) ??
    terms.find((t) => Object.values(t.label ?? {}).some((l) => foldText(l ?? '') === q)) ??
    null
  )
}

/**
 * Selection after adding `key`: kept in the list's order (what the chips do when
 * toggled), so choosing a new term here and in any other screen saves the same
 * array. Already chosen = unchanged. Keys that are not in the list keep their
 * place at the end.
 */
export function selectKey(value: readonly string[], key: string, orderedKeys: readonly string[]): string[] {
  if (value.includes(key)) return [...value]
  const next = new Set([...value, key])
  const known = orderedKeys.filter((k) => next.has(k))
  const rest = [...next].filter((k) => !orderedKeys.includes(k))
  return [...known, ...rest]
}

/** Selection after toggling `key` (same result as the chips' own toggle). */
export function toggleKey(value: readonly string[], key: string, orderedKeys: readonly string[]): string[] {
  return value.includes(key) ? value.filter((k) => k !== key) : selectKey(value, key, orderedKeys)
}

/** What a new term is created with: only the default language, text trimmed and collapsed. Null when empty. */
export function newTermLabels(text: string, defaultLocale: string): Record<string, string> | null {
  const label = websiteLabel(text)
  return label ? { [defaultLocale]: label } : null
}

/** Whether "+ Add" applies to this text: the person may add, text is not empty, and no term already has that name. */
export function canOfferCreate(opts: { canAdd: boolean; query: string; terms: readonly PickerTerm[]; ui: string; defaultLocale: string }): boolean {
  return opts.canAdd && !!cleanText(opts.query) && !findByLabel(opts.terms, opts.query, opts.ui, opts.defaultLocale)
}
