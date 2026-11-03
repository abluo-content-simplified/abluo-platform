// Server-only: never import from a client component.
// ── People — cross-project guard (ADR-043 D9) ─────────────────────────────────
//
// Every write that stores a person's publicId outside the People module —
// event schedules (instructor_public_ids / instructor_override), and, through
// their reference ids, post authors and event hosts — must prove that each id
// is a person OF THE SAME PROJECT. Until now store.ts only checked "is a UUID".
//
// Rule: every id is a UUID AND the publicId of a `person` document (published
// or draft) whose projectSlug is the caller's project. Anything else throws
// ONE opaque PersonError('invalid_value') — no hint about which id failed or
// whether it exists elsewhere, so ids of other websites cannot be probed.
//
// The projectSlug MUST come from the authorization grant, never from input.

import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { PersonError, UUID_RE, isPersonId } from './persons-lifecycle'

export const PEOPLE_GUARD_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && publicId in $ids && !(_id in path("versions.**"))].publicId`

/** At most this many ids per call (a schedule allows 50 instructors). */
export const PEOPLE_GUARD_MAX = 200

type Fetcher = { fetch: (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> }

export async function assertPeopleBelongToProject(
  projectSlug: string,
  publicIds: readonly string[],
  deps: { client?: Fetcher } = {}
): Promise<void> {
  const refuse = () => new PersonError('invalid_value', 'One of the people is not on this website.')
  if (typeof projectSlug !== 'string' || !projectSlug) throw refuse()
  if (!Array.isArray(publicIds)) throw refuse()
  if (publicIds.length === 0) return
  if (publicIds.length > PEOPLE_GUARD_MAX) throw refuse()
  const ids = new Set<string>()
  for (const id of publicIds) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw refuse()
    ids.add(id.toLowerCase())
  }
  const client = deps.client ?? (sanityWriteClient as unknown as Fetcher)
  let found: unknown
  try {
    found = await client.fetch(PEOPLE_GUARD_QUERY, { projectSlug, ids: [...ids] }, { perspective: 'raw' })
  } catch {
    throw new PersonError('failed', 'Could not check the people.')
  }
  const ok = new Set(Array.isArray(found) ? found.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : [])
  for (const id of ids) if (!ok.has(id)) throw refuse()
}

// ── Placement references (post authors, event hosts) ──────────────────────────
//
// `post.authors` / `event.hostPeople` hold weak references carrying the person's
// Sanity `_id` (not the publicId). The dashboard sends the ids; this rebuilds the
// stored array server-side: ONE raw read, every NEW id must be a person of the
// caller's project (published or draft-only), never anonymised or archived.
// An id already stored on the document is kept as stored even if the person was
// archived or deleted since (so reordering or removing others never fails), and
// keeps its `_key`. Everything refused is ONE opaque PersonError('invalid_value').

export const PEOPLE_REFS_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]{ _id, archivedAt, anonymisedAt }`

const REF_KEY = /^[A-Za-z0-9_-]{1,64}$/

export async function personRefs(
  projectSlug: string,
  value: unknown,
  opts: { max: number; stored?: unknown },
  deps: { client?: Fetcher } = {}
): Promise<Array<{ _type: 'reference'; _ref: string; _key: string; _weak: true }>> {
  const refuse = () => new PersonError('invalid_value', 'One of the people is not on this website.')
  if (typeof projectSlug !== 'string' || !projectSlug) throw refuse()
  if (!Array.isArray(value) || value.length > opts.max) throw refuse()
  if (!value.every((id) => isPersonId(id)) || new Set(value).size !== value.length) throw refuse()
  const ids = value as string[]
  if (ids.length === 0) return []
  const keys = new Map<string, string>()
  for (const r of Array.isArray(opts.stored) ? opts.stored : []) {
    const ref = (r as { _ref?: unknown })?._ref
    const key = (r as { _key?: unknown })?._key
    if (typeof ref !== 'string' || !ref) continue
    if (typeof key === 'string' && REF_KEY.test(key)) keys.set(ref.replace(/^drafts\./, ''), key)
  }
  const fresh = ids.filter((id) => !keys.has(id))
  if (fresh.length) {
    const client = deps.client ?? (sanityWriteClient as unknown as Fetcher)
    let rows: unknown
    try {
      rows = await client.fetch(PEOPLE_REFS_QUERY, { projectSlug, ids: fresh, draftIds: fresh.map((id) => `drafts.${id}`) }, { perspective: 'raw' })
    } catch {
      throw new PersonError('failed', 'Could not check the people.')
    }
    const usable = new Set<string>()
    const blocked = new Set<string>()
    for (const row of Array.isArray(rows) ? (rows as Array<{ _id?: unknown; archivedAt?: unknown; anonymisedAt?: unknown }>) : []) {
      if (typeof row?._id !== 'string') continue
      const id = row._id.replace(/^drafts\./, '')
      if (row.archivedAt != null || row.anonymisedAt != null) blocked.add(id)
      else usable.add(id)
    }
    // Archive / anonymise state lives on the published version; a blocked id never counts as usable.
    for (const id of fresh) if (!usable.has(id) || blocked.has(id)) throw refuse()
  }
  const used = new Set<string>()
  return ids.map((id, i) => {
    let key = keys.get(id) ?? (REF_KEY.test(id) ? id.slice(0, 64) : `person${i}`)
    while (used.has(key)) key = `${key.slice(0, 56)}-${i}`
    used.add(key)
    return { _type: 'reference' as const, _ref: id, _key: key, _weak: true as const }
  })
}

/** The person ids a stored reference array names (drafts. prefix dropped, de-duplicated). */
export function personRefIds(value: unknown): string[] {
  const out: string[] = []
  for (const r of Array.isArray(value) ? value : []) {
    const ref = (r as { _ref?: unknown } | null)?._ref
    if (typeof ref !== 'string' || !ref) continue
    const id = ref.replace(/^drafts\./, '')
    if (!out.includes(id)) out.push(id)
  }
  return out
}
