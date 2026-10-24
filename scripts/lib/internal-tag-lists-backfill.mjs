// Pure planner for scripts/backfill-internal-tag-lists.mjs — no network.
//
// Every tag a project's photos (`mediaAsset`) or galleries (`gallery`) carry
// today should also be on that project's `internalTagList` for the scope, so
// it stays in Categories & Tags after its last item drops it (Tom,
// 2026-10-24). The app keeps the lists complete from now on
// (src/lib/tags/list-sync.ts); this fills them for tags written before.
//
// Mirrors src/lib/tags/internal-tags.ts (tagMatchKey, list id, 500 cap) — the
// unit test checks the port against the TypeScript originals.

export const INTERNAL_TAG_LIST_TYPE = 'internalTagList'
export const INTERNAL_TAG_LIST_MAX = 500
export const SCOPES = /** @type {const} */ (['media', 'galleries'])
const SLUG_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Lower case, spaces collapsed, accents folded (= tagMatchKey). */
export function tagMatchKey(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** `internalTagList.<projectSlug>.<scope>`, or null for a slug that cannot form a safe id. */
export function listIdFor(projectSlug, scope) {
  if (!SLUG_PART.test(projectSlug ?? '') || !SCOPES.includes(scope)) return null
  return `${INTERNAL_TAG_LIST_TYPE}.${projectSlug}.${scope}`
}

const strings = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()) : [])
const isVersion = (id) => typeof id === 'string' && id.startsWith('versions.')
const isDraft = (id) => typeof id === 'string' && id.startsWith('drafts.')

/**
 * The tags items of one scope carry, most used first (then A–Z), each key once
 * (the first spelling met in that order wins). Photos: published only (as the
 * tag service reads them); galleries: published and drafts.
 */
export function usedTags(items, scope) {
  const type = scope === 'media' ? 'mediaAsset' : 'gallery'
  const counts = new Map()
  for (const it of items ?? []) {
    if (!it || it._type !== type || isVersion(it._id) || (scope === 'media' && isDraft(it._id))) continue
    for (const t of new Set(strings(it.tags).map((x) => x.trim()))) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([t]) => t)
  const seen = new Set()
  return ordered.filter((t) => {
    const k = tagMatchKey(t)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * One project's plan: per scope, the list id, what it holds, the names to
 * append (new keys only, up to the cap) and whether it must be created.
 *   input: { projectSlug, items: [{ _id, _type, tags }], lists: [{ _id, _rev, projectSlug, tags }] }
 */
export function planTagListBackfill({ projectSlug, items, lists }) {
  const scopes = []
  for (const scope of SCOPES) {
    const listId = listIdFor(projectSlug, scope)
    if (!listId) {
      scopes.push({ scope, listId: null, blocked: 'Project slug cannot form a list id.', add: [], existing: [], capped: false, create: false, rev: null })
      continue
    }
    const list = (lists ?? []).find((l) => l && l._id === listId && l.projectSlug === projectSlug) ?? null
    const existing = strings(list?.tags)
    const seen = new Set(existing.map(tagMatchKey))
    const add = []
    let capped = false
    for (const t of usedTags(items, scope)) {
      const k = tagMatchKey(t)
      if (seen.has(k)) continue
      if (existing.length + add.length >= INTERNAL_TAG_LIST_MAX) {
        capped = true
        break
      }
      seen.add(k)
      add.push(t)
    }
    scopes.push({ scope, listId, existing, add, capped, create: !list && add.length > 0, rev: list?._rev ?? null })
  }
  return { projectSlug, scopes }
}

/**
 * The mutations for --apply: a new list is `create`d (fails if one appeared
 * meanwhile — re-run), an existing one is patched with its revision. Nothing
 * else is touched; items are never modified.
 */
export function backfillMutations(plan) {
  const out = []
  for (const s of plan.scopes) {
    if (!s.listId || !s.add.length) continue
    if (s.create) out.push({ create: { _id: s.listId, _type: INTERNAL_TAG_LIST_TYPE, projectSlug: plan.projectSlug, scope: s.scope, tags: s.add } })
    else out.push({ patch: { id: s.listId, ifRevisionID: s.rev, set: { tags: [...s.existing, ...s.add] } } })
  }
  return out
}
