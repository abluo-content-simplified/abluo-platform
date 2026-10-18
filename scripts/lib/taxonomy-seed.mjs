/**
 * Pure planner for scripts/taxonomy/seed-categories.mjs
 * (ADR-033 Amendment J, J-8 step 2). No I/O, no network.
 *
 * Copies a project's config category list 1:1 into `taxonomyTerm` records, for
 * any module that declares `taxonomies` (catalogue, blog = Posts, news, events):
 * IDENTICAL key (= the list's `value`) and label map, deterministic id
 * `term.<projectSlug>.<module>.category.<key>` (mirrors src/lib/taxonomy/ids.ts),
 * `order` in steps of 1000 following the list order, colour kept. For a ROUTABLE
 * module (blog: public /category/<key> pages) the page fields are copied too:
 * description (per language), redirectFrom (the flat list of retired keys goes
 * under the site's default language; the website merges all languages), noindex.
 */

/** The modules the seed knows: the content type + field that store the keys, and whether terms are pages. */
export const SEED_MODULES = {
  catalogue: { type: 'catalogueItem', field: 'categories', routable: false },
  blog: { type: 'post', field: 'categories', routable: true },
  news: { type: 'newsArticle', field: 'categories', routable: false },
  events: { type: 'event', field: 'categories', routable: false },
}

export const SLUG_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const KEY_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
export const KEY_MAX = 48
export const ORDER_STEP = 1000
export const SEED_MARKER = 'seed:catalogue-categories'
export const seedMarkerFor = (module) => `seed:${module}-categories`

export const termIdFor = (projectSlug, key, module = 'catalogue') => `term.${projectSlug}.${module}.category.${key}`

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
export function planCategorySeed({ projectSlug, configList, existing = [], now, module = 'catalogue', routable = false, defaultLocale = 'en', by = seedMarkerFor(module) }) {
  const problems = []
  if (!SLUG_PART.test(module ?? '')) problems.push(`module "${module}" is not a valid module id`)
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
      items.push({ key, status: 'invalid', id: termIdFor(projectSlug, key, module), reason: 'duplicate key in the config list' })
      continue
    }
    seen.add(key)
    n += 1
    const id = termIdFor(projectSlug, key, module)
    const label = labelMapOf(entry.label)
    const prior = byId.get(id)
    const page = routable ? pageFieldsOf(entry, defaultLocale) : {}
    const ignored = routable ? [] : ignoredPageFields(entry)
    if (prior) {
      const sameLabel = JSON.stringify(labelMapOf(prior.label)) === JSON.stringify(label)
      const samePage = !routable || JSON.stringify(normPage(pageFromRecord(prior))) === JSON.stringify(normPage(page))
      const same = sameLabel && samePage
      items.push({ key, id, status: same ? 'exists' : 'differs', reason: same ? undefined : `a record with this id exists with ${sameLabel ? 'different page fields' : 'a different label'}; left untouched` })
      continue
    }
    const doc = {
      _id: id,
      _type: 'taxonomyTerm',
      projectSlug,
      module,
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
    if (page.description) doc.description = { _type: 'localizedText', ...page.description }
    if (page.redirectFrom) doc.redirectFrom = { _type: 'redirectFrom', [defaultLocale]: page.redirectFrom }
    if (page.noindex) doc.noindex = true
    items.push({ key, id, status: 'create', doc, ...(ignored.length ? { ignored } : {}) })
  }
  return { projectSlug, problems, items }
}

/** description / redirectFrom / noindex of a config entry, normalised (undefined when empty). */
export function pageFieldsOf(entry, defaultLocale = 'en') {
  const description = labelMapOf(entry?.description)
  const redirects = Array.isArray(entry?.redirectFrom) ? [...new Set(entry.redirectFrom.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))] : []
  return {
    ...(Object.keys(description).length ? { description } : {}),
    ...(redirects.length ? { redirectFrom: redirects } : {}),
    ...(entry?.noindex === true ? { noindex: true } : {}),
  }
}

/** Page fields present on an entry of a NON-routable module: they would be dropped, so they are reported. */
export function ignoredPageFields(entry) {
  const f = pageFieldsOf(entry)
  return Object.keys(f)
}

/** Page fields of a stored term record (redirectFrom per language -> one merged list). */
export function pageFromRecord(rec) {
  const rf = rec?.redirectFrom
  const merged = []
  if (rf && typeof rf === 'object') for (const [k, v] of Object.entries(rf)) if (!k.startsWith('_') && Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim() && !merged.includes(x.trim())) merged.push(x.trim())
  const description = labelMapOf(rec?.description)
  return {
    ...(Object.keys(description).length ? { description } : {}),
    ...(merged.length ? { redirectFrom: merged } : {}),
    ...(rec?.noindex === true ? { noindex: true } : {}),
  }
}
const normPage = (p) => ({ description: p.description ?? null, redirectFrom: [...(p.redirectFrom ?? [])].sort(), noindex: p.noindex === true })

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

// ── routable (page-level) before / after ─────────────────────────────────────
// What /category/<key> renders and serves, per key: title per language,
// description per language, colour, noindex, and the retired keys that 301 to it.
// Same fallback chain as findRoutableCategory (src/lib/modules/categories.ts).

/** @returns {Map<string, any>} key -> page view */
function pagesOf(entries, locales, defaultLocale) {
  const out = new Map()
  for (const e of entries) {
    const key = e.value
    const titles = {}
    const descriptions = {}
    for (const l of locales) {
      titles[l] = labelIn(e.label, l, defaultLocale, key)
      const d = labelMapOf(e.description)
      descriptions[l] = d[l] ?? d[defaultLocale] ?? d.en ?? Object.values(d)[0] ?? null
    }
    out.set(key, { titles, descriptions, color: typeof e.color === 'string' && e.color ? e.color : null, noindex: e.noindex === true, redirectFrom: [...(Array.isArray(e.redirectFrom) ? e.redirectFrom : [])].sort() })
  }
  return out
}

/** Term records as config-shaped entries (what the website's getModuleConfig builds from them). */
export function recordsAsEntries(terms) {
  return (terms ?? [])
    .filter((t) => typeof t?.key === 'string' && t.key)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((t) => ({ value: t.key, label: t.label, color: t.color, ...pageFromRecord(t) }))
}

/**
 * Per key: does the page served from the config list equal the page served from the
 * term records? Also lists retired keys that would stop redirecting or change target.
 * @returns {Array<{ key: string, identical: boolean, differences: string[] }>}
 */
export function compareRoutable({ configList, terms, locales, defaultLocale }) {
  const before = pagesOf(Array.isArray(configList) ? configList.filter((e) => typeof e?.value === 'string') : [], locales, defaultLocale)
  const after = pagesOf(vocabularyEntries(terms, configList), locales, defaultLocale)
  const rows = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key)
    const a = after.get(key)
    const differences = []
    if (!b) differences.push('only in term records')
    else if (!a) differences.push('missing from term records (URL would 404)')
    else {
      for (const f of ['titles', 'descriptions', 'color', 'noindex', 'redirectFrom']) if (JSON.stringify(b[f]) !== JSON.stringify(a[f])) differences.push(f)
    }
    rows.push({ key, identical: differences.length === 0, differences })
  }
  return rows
}

function vocabularyEntries(terms, configList) {
  const fromTerms = recordsAsEntries(terms)
  return fromTerms.length ? fromTerms : (Array.isArray(configList) ? configList.filter((e) => typeof e?.value === 'string') : [])
}
