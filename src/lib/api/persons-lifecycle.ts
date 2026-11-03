/**
 * People — permissions, error class, usage queries and the ADR-032 lifecycle
 * descriptor (ADR-043 D4, D8).
 *
 *   ARCHIVE   allowed while referenced: an archived person still shows on the
 *             content that names them (D4) and leaves team listings. Needs
 *             people.person.archive (owner).
 *   DELETE    permanent delete (archived people) and delete of a never-
 *             published draft are refused while ANY document of the project
 *             references the person (team sections, post authors, event
 *             hosts — any version, weak references too) OR an event schedule
 *             names them as instructor (Supabase, by publicId). Needs
 *             people.person.delete (owner).
 *
 * The error class lives here (not in persons.ts) so the descriptor, the guard
 * and the private store can build it without a circular import.
 */
// Server-only: service role (scheduling usage); never import from a client component.
import type { LifecycleClient, LifecycleDescriptor, LifecycleErrorCode, Referrer } from '@/lib/lifecycle/service'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { PEOPLE_PERMISSIONS, personDisplayName } from '@/lib/modules/people/model'

export const PEOPLE_READ_PERMISSION = PEOPLE_PERMISSIONS.read
export const PEOPLE_WRITE_PERMISSION = PEOPLE_PERMISSIONS.write
export const PEOPLE_ARCHIVE_PERMISSION = PEOPLE_PERMISSIONS.archive
export const PEOPLE_ANONYMISE_PERMISSION = PEOPLE_PERMISSIONS.anonymise
export const PEOPLE_DELETE_PERMISSION = PEOPLE_PERMISSIONS.delete

export type PersonErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'in_use'
  | 'archive_first'
  | 'archived'
  | 'anonymised'
  | 'missing_name'
  | 'missing_slug'
  | 'slug_taken'
  | 'private_unavailable'
  | 'failed'

/** Where a person is shown or named. `session` = event schedules (Supabase), counted, not listed one by one. */
export interface PersonUsage {
  kind: 'page' | 'post' | 'event' | 'sessions'
  /** Sanity document id (base id); '' for `sessions`. */
  id: string
  title: string
  /** The referencing content is public (sessions: always false — not evaluated). */
  published: boolean
  /** `sessions` only: how many series / sessions name the person. */
  count?: number
}

export class PersonError extends Error {
  constructor(
    readonly code: PersonErrorCode,
    message: string,
    /** in_use → where the person is used. */
    readonly detail?: { usedIn?: PersonUsage[] }
  ) {
    super(message)
    this.name = 'PersonError'
  }
}

const PERSON_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** A safe Sanity document id for a person (never with a drafts. prefix). */
export function isPersonId(id: unknown): id is string {
  return typeof id === 'string' && PERSON_ID.test(id)
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CODE: Record<LifecycleErrorCode, PersonErrorCode> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_value: 'invalid_value',
  archived: 'archived',
  archive_first: 'archive_first',
  in_use: 'in_use',
  unpublished_dependencies: 'failed',
  failed: 'failed',
}

const RAW = { perspective: 'raw' } as const

// ── Sanity usage (exported so tests assert exactly what runs) ────────────────

/**
 * Every document of the project that references the given people, in any
 * version: team sections (pages, legacy home pages, module pages), post
 * authors, event hosts. `live` = the referencing document is public now.
 */
export const PERSON_USAGE_QUERY = /* groq */ `*[projectSlug == $projectSlug && _type != "person"
    && !(_id in path("versions.**")) && references($ids)]{
    _id, _type, title,
    "live": select(_type == "post" => ${publicFilterFor('post')}, _type == "event" => ${publicFilterFor('event')}, true),
    "refs": array::compact([
      ...coalesce(sections[_type == "teamSection"].people[]._ref, []),
      ...coalesce(authors[]._ref, []),
      ...coalesce(hostPeople[]._ref, [])
    ])
  }`

/** EVERY document of the project that references the person in any version (weak references too), except its own versions. */
export const PERSON_DELETE_REFERRERS = /* groq */ `*[projectSlug == $projectSlug && references($id) && !(_id in [$id, $draftId]) && !(_id in path("versions.**"))]{ _id, _type, "label": coalesce(title, internalName, name) }`

type UsageRow = { _id: string; _type: string; title?: unknown; live?: boolean | null; refs?: unknown }
type Fetcher = { fetch: <T>(query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<T> }

const textOf = (value: unknown, locale: string): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  const pick = v[locale] ?? v.en ?? Object.entries(v).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x)?.[1]
  return typeof pick === 'string' ? pick : ''
}

const usageKind = (type: string): PersonUsage['kind'] => (type === 'post' ? 'post' : type === 'event' ? 'event' : 'page')

/** Sanity documents that reference each person (by Sanity id), one entry per document. */
export async function sanityPersonUsage(client: Fetcher, projectSlug: string, ids: string[], locale: string): Promise<Map<string, PersonUsage[]>> {
  const map = new Map<string, PersonUsage[]>()
  if (!ids.length) return map
  const rows = await client.fetch<UsageRow[] | null>(PERSON_USAGE_QUERY, { projectSlug, ids }, RAW)
  const docs = new Map<string, { kind: PersonUsage['kind']; title: string; refs: Set<string>; publishedRefs: Set<string>; hasDraftTitle: boolean }>()
  for (const row of rows ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    const refs = Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : []
    const entry = docs.get(id) ?? { kind: usageKind(row._type), title: '', refs: new Set<string>(), publishedRefs: new Set<string>(), hasDraftTitle: false }
    for (const r of refs) entry.refs.add(r)
    if (!isDraft && row.live !== false) for (const r of refs) entry.publishedRefs.add(r)
    const title = textOf(row.title, locale)
    if (title && (isDraft || !entry.hasDraftTitle)) {
      entry.title = title
      entry.hasDraftTitle = isDraft
    }
    docs.set(id, entry)
  }
  for (const [docId, d] of docs) {
    for (const personId of ids) {
      if (!d.refs.has(personId)) continue
      const list = map.get(personId) ?? []
      list.push({ kind: d.kind, id: docId, title: d.title, published: d.publishedRefs.has(personId) })
      map.set(personId, list)
    }
  }
  return map
}

// ── Scheduling usage (Supabase, migration 043) ───────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchedulingDb = { from: (table: string) => any }

/** Instructor publicIds named by live series / sessions of ONE project → how many rows name each. null = could not be read. */
export type ScheduleUsageFn = (projectId: string, publicIds: string[]) => Promise<Map<string, number> | null>

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? ''))

/**
 * Reads every live series and session of the project that names an instructor
 * and counts the wanted publicIds. A missing scheduling table counts as "none"
 * (nothing can name anyone); any other error returns null, and the callers
 * that need certainty (delete) refuse.
 */
export function createScheduleUsage(dbOverride?: SchedulingDb): ScheduleUsageFn {
  return async (projectId, publicIds) => {
    const wanted = new Set(publicIds.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase()))
    const out = new Map<string, number>()
    if (!UUID_RE.test(projectId) || wanted.size === 0) return out
    const run = async (db: SchedulingDb): Promise<Map<string, number> | null> => {
      const [series, sessions] = await Promise.all([
        db.from('event_series').select('instructor_public_ids').eq('project_id', projectId).is('removed_at', null).limit(5000),
        db.from('event_occurrences').select('instructor_override').eq('project_id', projectId).is('removed_at', null).not('instructor_override', 'is', null).limit(20000),
      ])
      for (const r of [series, sessions]) {
        if (r?.error && !isMissingTable(r.error)) return null
      }
      const count = (ids: unknown) => {
        if (!Array.isArray(ids)) return
        for (const raw of ids) {
          const id = typeof raw === 'string' ? raw.toLowerCase() : ''
          if (wanted.has(id)) out.set(id, (out.get(id) ?? 0) + 1)
        }
      }
      for (const row of (series?.error ? [] : series?.data ?? []) as Array<{ instructor_public_ids?: unknown }>) count(row.instructor_public_ids)
      for (const row of (sessions?.error ? [] : sessions?.data ?? []) as Array<{ instructor_override?: unknown }>) count(row.instructor_override)
      return out
    }
    try {
      if (dbOverride) return await run(dbOverride)
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
      return await runAsTrustedSystemOperation('ADR-043 — which event schedules name a person as instructor (read-only)', (sb) => run(sb as unknown as SchedulingDb))
    } catch {
      return null
    }
  }
}

// ── Lifecycle descriptor ─────────────────────────────────────────────────────

type Row = { _id: string; _type?: string; label?: unknown }

const FALLBACK: Record<string, string> = { page: 'Page', homePage: 'Home page', post: 'Post', event: 'Event' }

function named(rows: readonly Row[] | null | undefined): Referrer[] {
  const seen = new Map<string, Referrer>()
  for (const r of rows ?? []) {
    const id = r._id.replace(/^drafts\./, '')
    const type = typeof r._type === 'string' ? r._type : 'unknown'
    if (!seen.has(id)) seen.set(id, { id, type, label: textOf(r.label, 'en') || FALLBACK[type] || 'Untitled' })
  }
  return [...seen.values()]
}

/**
 * The descriptor for one person: deletes also check the scheduling tables
 * (Supabase), which the generic service cannot know, so the descriptor is
 * built per call with the person's publicId and project id.
 */
export function personLifecycle(scope: { projectId: string; publicId: string | null; scheduleUsage: ScheduleUsageFn }): LifecycleDescriptor {
  const allReferrers = async (client: LifecycleClient, id: string, projectSlug: string): Promise<Referrer[]> => {
    const rows = await client.fetch<Row[] | null>(PERSON_DELETE_REFERRERS, { id, draftId: `drafts.${id}`, projectSlug }, RAW)
    const refs = named(rows)
    if (scope.publicId) {
      const sessions = await scope.scheduleUsage(scope.projectId, [scope.publicId])
      if (sessions === null) throw new PersonError('failed', 'Could not check the event schedules.')
      const n = sessions.get(scope.publicId.toLowerCase()) ?? 0
      if (n > 0) refs.push({ id: '', type: 'eventSessions', label: `${n} event schedule${n === 1 ? '' : 's'}` })
    }
    return refs
  }
  return {
    type: 'person',
    rule: 'optional',
    permissions: {
      // This descriptor runs only archive / restore / delete: "write" here is
      // the ARCHIVE permission (owner), never the edit permission.
      write: PEOPLE_ARCHIVE_PERMISSION,
      delete: PEOPLE_DELETE_PERMISSION,
      deletePublished: PEOPLE_DELETE_PERMISSION,
    },
    isId: isPersonId,
    fail: (code, message) => new PersonError(CODE[code], message),
    refuseArchiveWhileReferenced: false,
    deleteReferrers: allReferrers,
    label: (doc) => personDisplayName(doc) || 'Person',
  }
}
