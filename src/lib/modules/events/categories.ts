// ── Event categories (dual-read) ──────────────────────────────────────────────
// ADR-033 Amendment J. Pure — no React, no I/O.
//
// Events store category KEYS (`event.categories`). The labels, colours and order
// live in one of two places while the migration runs:
//   1. `taxonomyTerm` records (module 'events', kind 'category') — the new store,
//      edited in the dashboard under Categories & Tags;
//   2. the module-config list (`moduleInstallations[events].config.categories`)
//      — the old store, edited in Studio → Modules.
// If a project has ANY term record the records are the whole vocabulary and the
// config list is ignored (categoryVocabulary); otherwise the config list is used
// exactly as before. Content needs no change: keys are copied identically.

import { categoryVocabulary, moduleTermsGroq, type CategoryTermRow, type VocabularyEntry } from '@/lib/taxonomy/vocabulary'
import type { ResolvedCategory } from '@/lib/modules/categories'

export const EVENT_MODULE_ID = 'events'

/** Term rows with the label map as stored (dashboard) — needs `$projectSlug`. */
export const EVENT_VOCABULARY_QUERY = /* groq */ `{
  "terms": ${moduleTermsGroq(EVENT_MODULE_ID, 'category', 'label')},
  "config": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "${EVENT_MODULE_ID}"][0].config.categories[]{ value, color, label }
}`

/** Term rows with the label already resolved to one language (website) — needs `$projectSlug`, `$locale`, `$defaultLocale`. */
export const EVENT_VOCABULARY_PUBLIC_QUERY = /* groq */ `{
  "terms": ${moduleTermsGroq(EVENT_MODULE_ID, 'category', 'coalesce(label[$locale], label[$defaultLocale], label.en)')},
  "config": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "${EVENT_MODULE_ID}"][0].config.categories[]{ value, color, "label": coalesce(label[$locale], label[$defaultLocale], label.en) }
}`

export type RawEventVocabulary = {
  terms?: readonly (CategoryTermRow | null)[] | null
  config?: readonly ({ value?: unknown; label?: unknown; color?: unknown } | null)[] | null
} | null | undefined

/** A selectable category: stable key, label per language, optional colour. */
export type EventCategoryOption = { value: string; label: Record<string, string>; color: string | null }

const labelMap = (label: unknown): Record<string, string> => {
  if (!label || typeof label !== 'object' || Array.isArray(label)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(label as Record<string, unknown>)) {
    if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

/** The vocabulary in display order: term records when any, else the config list. */
function entriesOf(raw: RawEventVocabulary): VocabularyEntry[] {
  const config = (Array.isArray(raw?.config) ? raw!.config! : [])
    .filter((c): c is NonNullable<typeof c> => !!c && typeof c.value === 'string' && c.value !== '')
    .map((c) => ({ value: c.value as string, label: c.label as VocabularyEntry['label'], color: typeof c.color === 'string' && c.color ? c.color : null }))
  return categoryVocabulary(raw?.terms, config)
}

/** Dashboard options (label maps kept whole, for the TermPicker and for validating a save). */
export function eventCategoryOptions(raw: RawEventVocabulary): EventCategoryOption[] {
  return entriesOf(raw).map((e) => ({ value: e.value, label: labelMap(e.label), color: typeof e.color === 'string' && e.color ? e.color : null }))
}

/**
 * Website: the stored keys as renderable categories, in the vocabulary's order.
 * `raw` came from EVENT_VOCABULARY_PUBLIC_QUERY (labels already one string).
 * A key with no entry is dropped, as for posts (a deleted category is not shown raw).
 */
export function resolveEventCategories(keys: readonly unknown[] | null | undefined, raw: RawEventVocabulary): ResolvedCategory[] {
  const selected = new Set((keys ?? []).filter((k): k is string => typeof k === 'string' && k !== ''))
  if (!selected.size) return []
  const out: ResolvedCategory[] = []
  for (const e of entriesOf(raw)) {
    if (!selected.has(e.value)) continue
    const title = typeof e.label === 'string' && e.label.trim() ? e.label : e.value
    out.push({ key: e.value, title, ...(typeof e.color === 'string' && e.color ? { color: e.color } : {}) })
  }
  return out
}
