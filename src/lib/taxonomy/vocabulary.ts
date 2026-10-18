// ── Catalogue category vocabulary (dual-read) ────────────────────────────────
// ADR-033 Amendment J, J-8 step 1. Pure — no React, no I/O.
//
// A project's Catalogue categories live in one of two places while the
// migration runs:
//
//   1. `taxonomyTerm` records (module 'catalogue', kind 'category') — the new
//      store, written by the dashboard service and the seed script;
//   2. the module-config list (`moduleInstallations[catalogue].config.categories`)
//      — the old store, still edited in the Studio Modules pane.
//
// Rule: if the project has ANY category term record, the term records are the
// vocabulary and the config list is ignored entirely (no mixing, so a key
// can never resolve against two different labels). If it has none, the config
// list is returned exactly as it came, so a project that has not been seeded
// reads precisely what it read before this slice.
//
// The output has the shape the existing code consumes — `{ value, label,
// color }` in the order the vocabulary is displayed — so resolveCategories /
// pickTerms / the dashboard pickers stay unchanged. Callers project the terms
// in GROQ (`key`, `label`, `color`, `order`); the label is passed through as
// it arrives (a localized map for the dashboard, an already locale-resolved
// string for the public query).

/** A `taxonomyTerm` as projected by the vocabulary queries. */
export type CategoryTermRow = {
  key?: unknown
  label?: unknown
  color?: unknown
  order?: unknown
}

/** An entry in the shape the config list has always had. */
export type VocabularyEntry = {
  value: string
  label: string | Record<string, unknown> | null | undefined
  color?: string | null
}

const isLabel = (v: unknown): v is VocabularyEntry['label'] => v == null || typeof v === 'string' || (typeof v === 'object' && !Array.isArray(v))

/** Term records → entries: valid keys only, first record per key, sorted by `order` then key. */
export function termsToEntries(terms: readonly (CategoryTermRow | null | undefined)[]): VocabularyEntry[] {
  const seen = new Set<string>()
  const rows: { entry: VocabularyEntry; order: number; at: number }[] = []
  terms.forEach((t, at) => {
    const key = typeof t?.key === 'string' ? t.key.trim() : ''
    if (!t || !key || seen.has(key)) return
    seen.add(key)
    const order = typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : Number.MAX_SAFE_INTEGER
    const entry: VocabularyEntry = { value: key, label: isLabel(t.label) ? t.label : undefined }
    if (typeof t.color === 'string' && t.color) entry.color = t.color
    rows.push({ entry, order, at })
  })
  rows.sort((a, b) => a.order - b.order || (a.entry.value < b.entry.value ? -1 : a.entry.value > b.entry.value ? 1 : a.at - b.at))
  return rows.map((r) => r.entry)
}

/**
 * The Catalogue category vocabulary for one project.
 *
 * `terms`: the project's catalogue category `taxonomyTerm` rows (any order);
 * `configList`: the legacy config list, returned untouched when there are no
 * usable term records.
 */
export function catalogueCategoryVocabulary<C>(
  terms: readonly (CategoryTermRow | null | undefined)[] | null | undefined,
  configList: C
): VocabularyEntry[] | C {
  const entries = termsToEntries(Array.isArray(terms) ? terms : [])
  return entries.length > 0 ? entries : configList
}

/**
 * GROQ subquery (an expression, to be embedded under a key of an existing
 * project-scoped query) for the term rows. `label` is `$label` verbatim, so the
 * dashboard keeps the whole map and the public query resolves a locale.
 * Always scoped by `$projectSlug`; term records have no drafts (liveEdit), the
 * draft exclusion is belt and braces for a Studio-created stray.
 */
export function catalogueCategoryTermsGroq(label: string): string {
  return catalogueTermsGroq('category', label)
}

/**
 * Slice 7 — the same subquery for any Catalogue kind. Tags have no legacy
 * config list, so their `taxonomyTerm` records are the whole vocabulary
 * (`tagVocabulary`).
 */
export function catalogueTermsGroq(kind: 'category' | 'tag', label: string): string {
  return moduleTermsGroq('catalogue', kind, label)
}

/**
 * The same subquery for any module (Events categories, …). The module id is
 * interpolated into the GROQ text, so it must be a plain identifier.
 */
export function moduleTermsGroq(module: string, kind: 'category' | 'tag', label: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(module)) throw new Error(`moduleTermsGroq: invalid module id "${module}"`)
  return `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "${module}" && kind == "${kind}" && !(_id in path("drafts.**"))] | order(order asc, key asc){ key, order, color, "label": ${label} }`
}

/**
 * The dual-read rule for any module's categories: term records replace the
 * legacy config list entirely when the project has any, else the config list
 * comes back untouched. (Same function as the Catalogue one — the rule is not
 * Catalogue-specific.)
 */
export const categoryVocabulary = catalogueCategoryVocabulary

/** The tag vocabulary: term records only (no config fallback — there never was a tag list). */
export function tagVocabulary(terms: readonly (CategoryTermRow | null | undefined)[] | null | undefined): VocabularyEntry[] {
  return termsToEntries(Array.isArray(terms) ? terms : [])
}

// ── Posts and News (module ids `blog`, `news`) ────────────────────────────────
// Same dual-read as Catalogue; blog categories are also public pages, so their
// term records can be turned back into the config-entry shape the website reads.

const MODULE_ID = /^[a-z][a-z0-9-]*$/

/** Keys only — for validating a selection against the vocabulary. */
export function moduleCategoryKeysGroq(module: string): string {
  if (!MODULE_ID.test(module)) throw new Error(`moduleCategoryKeysGroq: invalid module id "${module}"`)
  return `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "${module}" && kind == "category" && !(_id in path("drafts.**"))].key`
}

/**
 * Dual-read for a list of valid keys: the term keys when the project has any,
 * otherwise the legacy config list's keys (returned as read).
 */
export function categoryKeyVocabulary(termKeys: unknown, configKeys: readonly string[] | null | undefined): string[] {
  const fromTerms = (Array.isArray(termKeys) ? termKeys : []).filter((k): k is string => typeof k === 'string' && k.trim() !== '')
  return fromTerms.length > 0 ? fromTerms : [...(configKeys ?? [])]
}

/** A `taxonomyTerm` as the public config query projects it (raw maps, cleaned here). */
export type RoutableTermRow = CategoryTermRow & {
  description?: unknown
  redirectFrom?: unknown
  noindex?: unknown
}

/** A term in the shape of the legacy `ModuleConfigListEntry` (what the website reads). */
export type RoutableConfigEntry = {
  _key: string
  value: string
  label: Record<string, string>
  color?: string
  description?: Record<string, string>
  redirectFrom?: string[]
  noindex?: boolean
}

/** Keeps only non-empty text values; drops `_type`, `translationStatus` and nulls. */
export function cleanTextMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith('_') || k === 'translationStatus') continue
    if (typeof x === 'string' && x.trim() !== '') out[k] = x
  }
  return out
}

/**
 * A term's `redirectFrom` is per language (`{ en: [...], it: [...] }`); a
 * category URL is the same in every language, so the lists are merged into one
 * de-duplicated list of retired keys. A flat list passes through.
 */
export function flattenRedirectKeys(v: unknown): string[] {
  const out: string[] = []
  const add = (x: unknown) => {
    const s = typeof x === 'string' ? x.trim() : ''
    if (s && !out.includes(s)) out.push(s)
  }
  if (Array.isArray(v)) v.forEach(add)
  else if (v && typeof v === 'object') {
    for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
      if (!k.startsWith('_') && Array.isArray(list)) list.forEach(add)
    }
  }
  return out
}

/** Term rows → config entries, in display order. Empty when there is no usable row. */
export function termsToConfigEntries(terms: readonly (RoutableTermRow | null | undefined)[] | null | undefined): RoutableConfigEntry[] {
  const rows = Array.isArray(terms) ? terms : []
  const byKey = new Map<string, RoutableTermRow>()
  for (const r of rows) {
    const k = typeof r?.key === 'string' ? r.key.trim() : ''
    if (k && !byKey.has(k)) byKey.set(k, r as RoutableTermRow)
  }
  return termsToEntries(rows).map((e) => {
    const row = byKey.get(e.value) as RoutableTermRow
    const entry: RoutableConfigEntry = { _key: e.value, value: e.value, label: cleanTextMap(row.label) }
    if (e.color) entry.color = e.color
    const description = cleanTextMap(row.description)
    if (Object.keys(description).length > 0) entry.description = description
    const redirectFrom = flattenRedirectKeys(row.redirectFrom)
    if (redirectFrom.length > 0) entry.redirectFrom = redirectFrom
    if (row.noindex === true) entry.noindex = true
    return entry
  })
}

/** GROQ subquery: the module's category terms with every field the website needs (raw, cleaned by termsToConfigEntries). */
export function moduleRoutableTermsGroq(module: string): string {
  if (!MODULE_ID.test(module)) throw new Error(`moduleRoutableTermsGroq: invalid module id "${module}"`)
  return `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "${module}" && kind == "category" && !(_id in path("drafts.**"))] | order(order asc, key asc){ key, order, color, label, description, redirectFrom, noindex }`
}
