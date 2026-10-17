/**
 * Pure planner for scripts/taxonomy/seed-catalogue-categories.mjs
 * (ADR-033 Amendment J, J-8 step 2). No I/O, no network.
 *
 * Copies a project's Catalogue config category list 1:1 into `taxonomyTerm`
 * records: IDENTICAL key (= the list's `value`) and label map, deterministic id
 * `term.<projectSlug>.catalogue.category.<key>` (mirrors src/lib/taxonomy/ids.ts),
 * `order` in steps of 1000 following the list order, colour kept.
 */

export const SLUG_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const KEY_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
export const KEY_MAX = 48
export const ORDER_STEP = 1000
export const SEED_MARKER = 'seed:catalogue-categories'

export const termIdFor = (projectSlug, key) => `term.${projectSlug}.catalogue.category.${key}`

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Label map without Sanity bookkeeping keys (`_type`, `translationStatus`) and blank strings. */
export function labelMapOf(label) {
  const out = {}
  if (!isObj(label)) return out
  for (const [k, v] of Object.entries(label)) {
    if (k.startsWith('_') || k === 'translationStatus') continue
    if (typeof v === 'string' && v.trim() !== '') out[k] = v
  }
  return out
}

/**
 * @param {{ projectSlug: string, configList: unknown, existing?: Array<{ _id: string, key?: string, label?: unknown, color?: string }>, now: string, by?: string }} input
 * @returns {{ projectSlug: string, problems: string[], items: Array<{ key: string, status: 'create'|'exists'|'differs'|'invalid', id: string, doc?: any, reason?: string }> }}
 */
export function planCategorySeed({ projectSlug, configList, existing = [], now, by = SEED_MARKER }) {
  const problems = []
  if (!SLUG_PART.test(projectSlug ?? '')) problems.push(`projectSlug "${projectSlug}" is not a valid slug`)
  const byId = new Map(existing.map((e) => [e._id, e]))
  const seen = new Set()
  const items = []
  const list = Array.isArray(configList) ? configList : []
  let n = 0
  for (const entry of list) {
    const key = isObj(entry) && typeof entry.value === 'string' ? entry.value : ''
    if (!key) {
      items.push({ key: '', status: 'invalid', id: '', reason: 'entry without a value' })
      continue
    }
    if (!KEY_PATTERN.test(key) || key.length > KEY_MAX) {
      items.push({ key, status: 'invalid', id: '', reason: `key does not satisfy ${KEY_PATTERN} (max ${KEY_MAX}) — it would need a manual decision` })
      continue
    }
    if (seen.has(key)) {
      items.push({ key, status: 'invalid', id: termIdFor(projectSlug, key), reason: 'duplicate key in the config list' })
      continue
    }
    seen.add(key)
    n += 1
    const id = termIdFor(projectSlug, key)
    const label = labelMapOf(entry.label)
    const prior = byId.get(id)
    if (prior) {
      const same = JSON.stringify(labelMapOf(prior.label)) === JSON.stringify(label)
      items.push({ key, id, status: same ? 'exists' : 'differs', reason: same ? undefined : 'a record with this id exists with a different label; left untouched' })
      continue
    }
    const doc = {
      _id: id,
      _type: 'taxonomyTerm',
      projectSlug,
      module: 'catalogue',
      kind: 'category',
      key,
      label: { _type: 'localizedString', ...label },
      order: n * ORDER_STEP,
      createdAt: now,
      createdBy: by,
      updatedAt: now,
      updatedBy: by,
    }
    if (typeof entry.color === 'string' && entry.color) doc.color = entry.color
    items.push({ key, id, status: 'create', doc })
  }
  return { projectSlug, problems, items }
}

/** `createIfNotExists` mutations — never create/replace/patch, so a re-run (or a concurrent dashboard create) cannot overwrite. */
export const seedMutations = (plan) => plan.items.filter((i) => i.status === 'create').map((i) => ({ createIfNotExists: i.doc }))

// ── before / after ────────────────────────────────────────────────────────────
// Same resolution as src/lib/modules/catalogue/resolve.ts (pickTerms): stored
// keys → vocabulary entries, in stored order, unknown keys dropped, duplicates
// collapsed. Label chain: locale → defaultLocale → en → any → key.

const labelIn = (label, locale, defaultLocale, key) => {
  const m = labelMapOf(label)
  return m[locale] ?? m[defaultLocale] ?? m.en ?? Object.values(m)[0] ?? key
}

/** @returns {Array<{ value: string, label: string, color: string | null }>} */
export function resolveWith(keys, vocabulary, locale, defaultLocale) {
  const byValue = new Map(vocabulary.map((e) => [e.value, e]))
  const seen = new Set()
  const out = []
  for (const k of Array.isArray(keys) ? keys : []) {
    const e = byValue.get(k)
    if (e && !seen.has(k)) {
      seen.add(k)
      out.push({ value: k, label: labelIn(e.label, locale, defaultLocale, k), color: typeof e.color === 'string' && e.color ? e.color : null })
    }
  }
  return out
}

/** Vocabulary as the dual-read helper sees it: term records (sorted by order, key) when any, else the config list. */
/** @returns {any[]} */
export function vocabularyOf(terms, configList) {
  const rows = (terms ?? [])
    .filter((t) => typeof t?.key === 'string' && t.key)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((t) => ({ value: t.key, label: t.label, color: t.color }))
  return rows.length ? rows : (Array.isArray(configList) ? configList : [])
}

/**
 * For each item: the categories resolved from the config list vs from the
 * term records (simulated as if those would be written, plus any that exist).
 * `identical` per item per locale.
 */
/**
 * @param {{ items: Array<{ id: string, name?: string, categories?: string[] }>, configList: any, terms: any[], locales: string[], defaultLocale: string }} input
 * @returns {Array<{ id: string, name?: string, keys: string[], identical: boolean, perLocale: Array<{ locale: string, before: ReturnType<typeof resolveWith>, after: ReturnType<typeof resolveWith>, identical: boolean }> }>}
 */
export function compareResolved({ items, configList, terms, locales, defaultLocale }) {
  return items.map((item) => {
    const perLocale = locales.map((locale) => {
      const before = resolveWith(item.categories, vocabularyOf([], configList), locale, defaultLocale)
      const after = resolveWith(item.categories, vocabularyOf(terms, configList), locale, defaultLocale)
      return { locale, before, after, identical: JSON.stringify(before) === JSON.stringify(after) }
    })
    return { id: item.id, name: item.name, keys: item.categories ?? [], perLocale, identical: perLocale.every((p) => p.identical) }
  })
}
