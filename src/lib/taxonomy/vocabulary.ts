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
  return `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "catalogue" && kind == "${kind}" && !(_id in path("drafts.**"))] | order(order asc, key asc){ key, order, color, "label": ${label} }`
}

/** The tag vocabulary: term records only (no config fallback — there never was a tag list). */
export function tagVocabulary(terms: readonly (CategoryTermRow | null | undefined)[] | null | undefined): VocabularyEntry[] {
  return termsToEntries(Array.isArray(terms) ? terms : [])
}
