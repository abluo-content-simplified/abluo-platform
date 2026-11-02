// ── Catalogue taxonomy seed — term records → `catalogueTaxonomy` (C1.9 D1 / R2) ──
//
// THE single pure function both the D1 data step
// (scripts/catalogue/migrate-taxonomy.mjs) and, from R2, the
// `CatalogueTaxonomyService` first-write seeding use (C1.9: "with the same pure
// function the D1 script uses (`seedTaxonomyFromTerms(terms, configList)`)").
// Written by the rollout workstream against the contract signature; the R2
// service imports it — it must not grow a second copy.
//
// Rules (C1.9 step 1):
//   - categories come from `taxonomyTerm` records (module catalogue, kind category)
//     when the project has any; else from the legacy `config.categories` list;
//   - tags come from the tag term records (there never was a tag list);
//   - keys are copied VERBATIM (immutable, incl. `illustrated_boos`), labels are
//     copied verbatim (the localized map as stored), every category is a root,
//     no channel rules, no archived state;
//   - order: the record's finite `order` is kept; records without one follow in
//     today's vocabulary order (order asc, key asc), spaced by ORDER_STEP.
//   - the first record per key wins (today's termsToEntries rule); later
//     duplicates are reported, never merged.
//
// Pure: no I/O, no clock.

import { ORDER_STEP } from '@/lib/taxonomy/rules'

export type SeedTermRow = { kind?: unknown; key?: unknown; label?: unknown; order?: unknown; color?: unknown }
export type SeedConfigEntry = { value?: unknown; label?: unknown; color?: unknown }

export type SeededCategory = { _key: string; _type: 'catalogueCategory'; key: string; label: Record<string, unknown>; order: number }
export type SeededTag = { _key: string; _type: 'catalogueTag'; key: string; label: Record<string, unknown>; order: number }

export type SeedFinding =
  | { code: 'duplicateKey'; kind: 'category' | 'tag'; key: string }
  | { code: 'invalidRow'; kind: 'category' | 'tag'; index: number }
  /** C1.4 has no colour on a Catalogue category: the value is not carried (listed, never silent). */
  | { code: 'colorNotCarried'; key: string; color: string }

export type TaxonomySeed = {
  categories: SeededCategory[]
  tags: SeededTag[]
  categorySource: 'terms' | 'config' | 'none'
  findings: SeedFinding[]
}

const keyOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const labelOf = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : typeof v === 'string' && v.trim() ? { _type: 'localizedString', en: v } : { _type: 'localizedString' }

type Row = { key: string; label: Record<string, unknown>; order: number | null; color: string | null; at: number }

function rowsOf(input: readonly unknown[], kind: 'category' | 'tag', keyField: 'key' | 'value', findings: SeedFinding[]): Row[] {
  const seen = new Set<string>()
  const out: Row[] = []
  input.forEach((raw, at) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const key = keyOf(r[keyField])
    if (!raw || typeof raw !== 'object' || !key) {
      findings.push({ code: 'invalidRow', kind, index: at })
      return
    }
    if (seen.has(key)) {
      findings.push({ code: 'duplicateKey', kind, key })
      return
    }
    seen.add(key)
    out.push({
      key,
      label: labelOf(r.label),
      order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : null,
      color: typeof r.color === 'string' && r.color ? r.color : null,
      at,
    })
  })
  return out
}

/** Today's vocabulary order (termsToEntries): order asc (missing last), key asc; then orders assigned. */
function ordered(rows: Row[]): { row: Row; order: number }[] {
  const sorted = [...rows].sort((a, b) => {
    const oa = a.order ?? Number.MAX_SAFE_INTEGER
    const ob = b.order ?? Number.MAX_SAFE_INTEGER
    return oa - ob || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.at - b.at)
  })
  let last = 0
  return sorted.map((row) => {
    const order = row.order ?? last + ORDER_STEP
    last = Math.max(last, order)
    return { row, order }
  })
}

/**
 * Term records (any kinds; Catalogue module only — the caller filters by project and
 * module) plus the legacy config list → the `categories`/`tags` arrays of
 * `catalogue-taxonomy.<slug>`. Deterministic: same input → byte-identical output.
 */
export function seedTaxonomyFromTerms(terms: readonly (SeedTermRow | null | undefined)[] | null | undefined, configList: readonly (SeedConfigEntry | null | undefined)[] | null | undefined): TaxonomySeed {
  const findings: SeedFinding[] = []
  const all = Array.isArray(terms) ? terms : []
  const categoryTerms = rowsOf(all.filter((t) => (t as SeedTermRow | null)?.kind === 'category'), 'category', 'key', findings)
  const tagTerms = rowsOf(all.filter((t) => (t as SeedTermRow | null)?.kind === 'tag'), 'tag', 'key', findings)

  let categoryRows: Row[]
  let categorySource: TaxonomySeed['categorySource']
  if (categoryTerms.length > 0) {
    categoryRows = categoryTerms
    categorySource = 'terms'
  } else {
    // Legacy list: its stored order IS the vocabulary order (no `order` field).
    const fromConfig = rowsOf(Array.isArray(configList) ? configList : [], 'category', 'value', findings).map((r, i) => ({ ...r, order: (i + 1) * ORDER_STEP }))
    categoryRows = fromConfig
    categorySource = fromConfig.length > 0 ? 'config' : 'none'
  }

  const categories = ordered(categoryRows).map(({ row, order }): SeededCategory => {
    if (row.color) findings.push({ code: 'colorNotCarried', key: row.key, color: row.color })
    return { _key: row.key, _type: 'catalogueCategory', key: row.key, label: row.label, order }
  })
  const tags = ordered(tagTerms).map(({ row, order }): SeededTag => ({ _key: row.key, _type: 'catalogueTag', key: row.key, label: row.label, order }))
  return { categories, tags, categorySource, findings }
}
