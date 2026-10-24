/**
 * Internal tags — the finding aid on photos and galleries (ADR-022: never
 * public). Pure helpers shared by the dashboard and the server; no I/O.
 *
 * Two SEPARATE vocabularies (Tom): `media` (photos in the Media Library) and
 * `galleries`. A vocabulary is what the items carry, PLUS the tags added in
 * Categories & Tags before any item uses them: those live in one small
 * `internalTagList` document per project and scope (deterministic id), so a
 * new tag shows "Not used yet". Rename / merge / delete keep that list in step.
 */
import { internalTag } from '@/lib/tag-text'
import { SLUG_PART_PATTERN } from '@/lib/taxonomy/ids'

export type InternalTagScope = 'media' | 'galleries'

/** Same limits as the photo and gallery writers (PHOTO_LIMITS / GALLERY_LIMITS). */
export const INTERNAL_TAG_LIMITS = { perItem: 10, length: 40 } as const

export const MEDIA_MANAGE = 'media.library.manage'
export const GALLERY_READ = 'gallery.gallery.read'
export const GALLERY_WRITE = 'gallery.gallery.write'
export const GALLERY_MODULE_ID = 'gallery'

export type InternalTagGrant = { permissions: readonly string[]; enabledModuleIds: readonly string[] }

/**
 * Which tag lists this person can open, and whether they can change them.
 * Media: the Media Library gate (`media.library.manage`, no module). Galleries:
 * the gallery module is installed and they may read galleries; changing needs
 * gallery write. UI hint only — the service re-checks.
 */
export function internalTagScopes(grant: InternalTagGrant): { scope: InternalTagScope; canWrite: boolean }[] {
  const out: { scope: InternalTagScope; canWrite: boolean }[] = []
  if (grant.permissions.includes(MEDIA_MANAGE)) out.push({ scope: 'media', canWrite: true })
  if (grant.enabledModuleIds.includes(GALLERY_MODULE_ID) && grant.permissions.includes(GALLERY_READ)) {
    out.push({ scope: 'galleries', canWrite: grant.permissions.includes(GALLERY_WRITE) })
  }
  return out
}

// ── The added-but-unused list ─────────────────────────────────────────────────

/** Document type of the per-project, per-scope list of added tags. */
export const INTERNAL_TAG_LIST_TYPE = 'internalTagList'
/** Most tags one list may hold (a finding aid, not a dictionary). */
export const INTERNAL_TAG_LIST_MAX = 500
export const INTERNAL_TAG_SCOPES = ['media', 'galleries'] as const

/**
 * The list's deterministic id: `internalTagList.<projectSlug>.<scope>`. One per
 * project and scope, never shared. Throws on a slug that could forge another id.
 */
export function internalTagListId(projectSlug: string, scope: InternalTagScope): string {
  if (!SLUG_PART_PATTERN.test(projectSlug ?? '')) throw new Error('Invalid project slug for a tag list.')
  if (!(INTERNAL_TAG_SCOPES as readonly string[]).includes(scope)) throw new Error('Invalid tag list scope.')
  return `${INTERNAL_TAG_LIST_TYPE}.${projectSlug}.${scope}`
}

/**
 * The existing tag that `typed` would duplicate (same letters ignoring case,
 * accents and spacing: "Ete" duplicates "Été"), or null.
 */
export function findDuplicateTag(typed: string, existing: readonly string[]): string | null {
  const key = tagMatchKey(normaliseInternalTag(typed))
  if (!key) return null
  return existing.find((e) => tagMatchKey(e) === key) ?? null
}

/** Lower case, spaces collapsed, accents folded: "Café  Bar" and "cafe bar" are the same tag. */
export function tagMatchKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** One tag the way the server stores it (lib/tag-text internalTag, ≤ 40 characters). '' = nothing usable. */
export function normaliseInternalTag(raw: string): string {
  return internalTag(raw).slice(0, INTERNAL_TAG_LIMITS.length).trim()
}

/**
 * What to store for something typed: the spelling already in use when the
 * typed text matches an existing tag ignoring case/accents ("cafe" → "café"),
 * else the normalised text. '' when nothing usable.
 */
export function resolveTagSpelling(raw: string, existing: readonly string[]): string {
  const tag = normaliseInternalTag(raw)
  if (!tag) return ''
  const key = tagMatchKey(tag)
  return existing.find((e) => tagMatchKey(e) === key) ?? tag
}

// ── Usage ─────────────────────────────────────────────────────────────────────

/** One photo or gallery with its tags. */
export type TagRow = { id: string; tags: string[] }
export type TagCount = { tag: string; count: number }

/** Tags by number of items using them (once per item), most used first, then A–Z. */
export function countTags(rows: readonly TagRow[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const r of rows) for (const t of new Set(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ── Tags manager: order and search ────────────────────────────────────────────

/** How the Categories & Tags → Media / Galleries list is ordered. A–Z is the default. */
export const TAG_SORTS = ['az', 'used'] as const
export type TagSort = (typeof TAG_SORTS)[number]

/** The search box shows only once a list is longer than this. */
export const TAG_SEARCH_THRESHOLD = 20

/** Whether the tags manager offers a search box for a list of `total` tags. */
export function showTagSearch(total: number): boolean {
  return total > TAG_SEARCH_THRESHOLD
}

/**
 * The tags in the chosen order. A–Z follows the dashboard language and ignores
 * case and accents ("été" sits with "ete", "Zebra" after "apple"); Most used is
 * by number of items, ties A–Z. Never mutates `counts`.
 */
export function sortTagCounts(counts: readonly TagCount[], sort: TagSort, locale = 'en'): TagCount[] {
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  } catch {
    collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  }
  const az = (a: TagCount, b: TagCount) => collator.compare(a.tag, b.tag) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
  return [...counts].sort(sort === 'used' ? (a, b) => b.count - a.count || az(a, b) : az)
}

/**
 * The manager's list: the tags items carry (with their counts) plus the added
 * tags no item uses yet, at 0. A listed name that items already carry (even
 * spelt with other accents) is not shown twice.
 */
export function countTagsWithListed(rows: readonly TagRow[], listed: readonly string[]): TagCount[] {
  const counts = countTags(rows)
  const seen = new Set(counts.map((c) => tagMatchKey(c.tag)))
  for (const tag of listed) {
    const key = tagMatchKey(tag)
    if (!key || seen.has(key)) continue
    seen.add(key)
    counts.push({ tag, count: 0 })
  }
  return counts
}

/** The added-tags list after a rename / merge / delete (each name once). */
export function rewriteListed(listed: readonly string[], change: TagChange): string[] {
  return [...new Set(rewriteTags(listed, change))]
}

/** The `n` most used tags (the chips shown under an empty tag box). */
export function topTags(counts: readonly TagCount[], n = 8, exclude: readonly string[] = []): string[] {
  const out = new Set(exclude)
  return counts.filter((c) => !out.has(c.tag)).slice(0, n).map((c) => c.tag)
}

/**
 * Suggestions while typing: accent-insensitive; tags that START with the text
 * first, then tags that contain it; each group most used first. Tags already
 * chosen are left out.
 */
export function suggestTags(counts: readonly TagCount[], typed: string, chosen: readonly string[] = [], limit = 6): string[] {
  const q = tagMatchKey(typed)
  if (!q) return []
  const taken = new Set(chosen.map(tagMatchKey))
  const starts: string[] = []
  const inside: string[] = []
  for (const c of counts) {
    const k = tagMatchKey(c.tag)
    if (taken.has(k)) continue
    if (k.startsWith(q)) starts.push(c.tag)
    else if (k.includes(q)) inside.push(c.tag)
  }
  return [...starts, ...inside].slice(0, limit)
}

/** Counts from a plain list of tags, for callers that only have names (old `suggestions` prop): all counted once, in the given order. */
export function countsFromNames(names: readonly string[]): TagCount[] {
  return [...new Set(names)].map((tag, i, all) => ({ tag, count: all.length - i }))
}

// ── Changes ───────────────────────────────────────────────────────────────────

/** Rename is a merge of one tag. Delete removes the tags from every item. */
export type TagChange = { op: 'merge'; from: string[]; to: string } | { op: 'delete'; tags: string[] }

export function changeTargets(change: TagChange): string[] {
  return change.op === 'merge' ? change.from : change.tags
}

/** Whether `own` carries a tag the change touches. */
export function changeAffects(own: readonly string[], change: TagChange): boolean {
  const hit = new Set(changeTargets(change))
  return own.some((t) => hit.has(t))
}

/**
 * The item's tags after the change. A merge puts `to` where the first changed
 * tag stood and keeps it once; never more tags than before. Untouched items
 * come back as the same values.
 */
export function rewriteTags(own: readonly string[], change: TagChange): string[] {
  if (!changeAffects(own, change)) return [...own]
  const hit = new Set(changeTargets(change))
  if (change.op === 'delete') return own.filter((t) => !hit.has(t))
  const out: string[] = []
  let placed = false
  for (const t of own) {
    if (hit.has(t) || t === change.to) {
      if (!placed) {
        out.push(change.to)
        placed = true
      }
    } else out.push(t)
  }
  if (!placed) out.push(change.to)
  return out
}

/** The rows after the change (only affected rows are new objects). */
export function applyChangeToRows(rows: readonly TagRow[], change: TagChange): TagRow[] {
  return rows.map((r) => (changeAffects(r.tags, change) ? { ...r, tags: rewriteTags(r.tags, change) } : r))
}

/** What a change does, for a summary: how many items change. */
export function countAffected(rows: readonly TagRow[], change: TagChange): number {
  return rows.filter((r) => changeAffects(r.tags, change)).length
}

/** Validates a merge request: ≥ 1 source, a usable target. Returns the cleaned change or null. */
export function cleanChange(change: TagChange): TagChange | null {
  if (change.op === 'delete') {
    const tags = [...new Set(change.tags.filter((t) => typeof t === 'string' && t))]
    return tags.length ? { op: 'delete', tags } : null
  }
  const to = normaliseInternalTag(change.to)
  const from = [...new Set(change.from.filter((t) => typeof t === 'string' && t))]
  if (!to || !from.length) return null
  if (from.length === 1 && from[0] === to) return null
  return { op: 'merge', from, to }
}

/**
 * Renaming `from` to `typed`: the existing tag it would run into (same
 * ignoring case/accents, and not `from` itself), else null.
 */
export function renameCollision(counts: readonly TagCount[], from: string, typed: string): string | null {
  const key = tagMatchKey(normaliseInternalTag(typed))
  if (!key) return null
  return counts.find((c) => c.tag !== from && tagMatchKey(c.tag) === key)?.tag ?? null
}
