// ── Categories & Tags manager — view model ────────────────────────────────────
// ADR-033 Amendment J, slice 4. Pure: turns the service's `TermList` into what
// the screen draws (rows, language chips, summary, delete state) and keeps the
// local list in step with the server's answers. No React, no server imports
// (types only), so the rules are unit-tested.

import type { ListedTerm, TermList, TermUsageItem } from '@/lib/taxonomy/service'

export type TermsFilter = 'all' | 'missing'

/** The manager's lists are keyed `module:kind`. */
export const listKey = (module: string, kind: string) => `${module}:${kind}`

export type ChipView = { locale: string; code: string; complete: boolean }
export type RowView = {
  key: string
  name: string
  usedBy: number
  chips: ChipView[]
  needsTranslation: boolean
}

/** What the screen needs of a list. `ListedTerm` carries the coverage per term. */
export type ListState = Pick<TermList, 'module' | 'kind' | 'defaultLocale' | 'locales' | 'canWrite' | 'color'> & { terms: ListedTerm[] }

/** The term's name for the lists: default language, else any language. Never the key. */
export function termName(term: Pick<ListedTerm, 'label'>, defaultLocale: string): string {
  const own = term.label[defaultLocale]?.trim()
  if (own) return own
  return Object.values(term.label).find((v) => v.trim())?.trim() ?? ''
}

/** Translation UI only makes sense when the site has more than one language. */
export const hasTranslations = (list: Pick<ListState, 'locales'>) => list.locales.length > 1

export function summarize(terms: readonly ListedTerm[]): { needTranslation: number; total: number } {
  return { needTranslation: terms.filter((t) => !t.coverage.isComplete).length, total: terms.length }
}

export function buildRows(list: Pick<ListState, 'terms' | 'defaultLocale'>, filter: TermsFilter): RowView[] {
  return list.terms
    .filter((t) => filter === 'all' || !t.coverage.isComplete)
    .map((t) => ({
      key: t.key,
      name: termName(t, list.defaultLocale),
      usedBy: t.usedBy,
      chips: t.coverage.perLocale.map((p) => ({ locale: p.locale, code: p.locale.toUpperCase(), complete: p.complete })),
      needsTranslation: !t.coverage.isComplete,
    }))
}

// ── Keeping the local list in step with the server ────────────────────────────

const byOrder = (a: ListedTerm, b: ListedTerm) => a.order - b.order || a.key.localeCompare(b.key)

/** Adds or replaces a term (keeping its "used by" count when replacing), in list order. */
export function upsertTerm<T extends Pick<ListState, 'terms'>>(list: T, term: Omit<ListedTerm, 'usedBy'> & { usedBy?: number }): T {
  const prev = list.terms.find((t) => t.key === term.key)
  const next: ListedTerm = { ...term, usedBy: term.usedBy ?? prev?.usedBy ?? 0 }
  const terms = prev ? list.terms.map((t) => (t.key === term.key ? next : t)) : [...list.terms, next]
  return { ...list, terms: prev ? terms : terms.sort(byOrder) }
}

export function removeTerm<T extends Pick<ListState, 'terms'>>(list: T, key: string): T {
  return { ...list, terms: list.terms.filter((t) => t.key !== key) }
}

/** The list in the order the server confirmed (`order` answers of reorderTerms). */
export function applyOrder<T extends Pick<ListState, 'terms'>>(list: T, order: ReadonlyArray<{ key: string; order: number }>): T {
  const at = new Map(order.map((o) => [o.key, o.order]))
  return { ...list, terms: list.terms.map((t) => (at.has(t.key) ? { ...t, order: at.get(t.key)! } : t)).sort(byOrder) }
}

/** The keys with `key` moved one place up (-1) or down (+1); null when it cannot move. */
export function moveKey(keys: readonly string[], key: string, direction: -1 | 1): string[] | null {
  const from = keys.indexOf(key)
  const to = from + direction
  if (from < 0 || to < 0 || to >= keys.length) return null
  const next = [...keys]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** The keys with `key` moved to index `to` of the result (a drop); null when it would not move. */
export function moveKeyTo(keys: readonly string[], key: string, to: number): string[] | null {
  const from = keys.indexOf(key)
  if (from < 0 || to < 0 || to >= keys.length || to === from) return null
  const next = [...keys]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** Same terms, ordered by `keys` first (optimistic reorder); unlisted terms follow. */
export function reorderLocally<T extends Pick<ListState, 'terms'>>(list: T, keys: readonly string[]): T {
  const rank = new Map(keys.map((k, i) => [k, i]))
  const terms = [...list.terms].sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9))
  return { ...list, terms }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export type UsageView = { count: number; items: Array<{ id: string; name: string; type: string }> }
export type DeleteState =
  | { kind: 'free' }
  | { kind: 'blocked'; count: number; shown: Array<{ id: string; name: string; type: string }>; more: number }
  /** Unused, but old web addresses still redirect to its public page (blog categories): delete stays off. */
  | { kind: 'protected'; redirects: number }

export const USAGE_ITEMS_SHOWN = 10

/**
 * Unused → delete is offered (after a confirmation). Used → delete is off, with
 * the count and up to 10 items; "and N more" names the rest. `usage` is what the
 * server last said (it wins over the list's cached count, which may be stale).
 */
export function deleteState(usedBy: number, usage: UsageView | null, redirects = 0): DeleteState {
  const count = usage ? usage.count : usedBy
  if (count <= 0) return redirects > 0 ? { kind: 'protected', redirects } : { kind: 'free' }
  const shown = (usage?.items ?? []).slice(0, USAGE_ITEMS_SHOWN)
  return { kind: 'blocked', count, shown, more: Math.max(0, count - shown.length) }
}

/** Locale-agnostic link to the editor of a used item; null when the screen has no editor for it. */
export function itemHref(projectSlug: string, item: Pick<TermUsageItem, 'id' | 'type'>): string | null {
  if (!item.id) return null
  const id = encodeURIComponent(item.id)
  if (item.type === 'catalogueItem') return `/${projectSlug}/catalogue/${id}`
  if (item.type === 'post') return `/${projectSlug}/posts/write/${id}`
  if (item.type === 'event') return `/${projectSlug}/agenda/${id}`
  return null
}

// ── Errors ────────────────────────────────────────────────────────────────────

const KNOWN_ERRORS = ['label_required', 'label_too_long', 'too_many_terms', 'conflict', 'forbidden', 'unauthenticated', 'in_use', 'has_redirects', 'not_found', 'invalid_value'] as const
/** Message key (`clientDashboard.taxonomy.errors.<key>`) for an action error code. */
export function errorKey(code: string | undefined): string {
  return (KNOWN_ERRORS as readonly string[]).includes(code ?? '') ? (code as string) : 'failed'
}

/** Trimmed, whitespace-collapsed label text as the server will store it. */
export const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ')
