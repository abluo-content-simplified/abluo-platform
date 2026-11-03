// Server-only: service role; never import from a client component.
// ── People — the private store (Supabase person_private, migration 063) ───────
//
// The ONLY code that talks to public.person_private (ADR-043 D2, ADR-038 D8
// pattern). Every read and write is scoped by project_id; the table is
// server-only (RLS on, no grants to anon/authenticated). Authorisation is the
// caller's job (persons.ts runs assertModuleAction first).
//
// "Table missing" (migration 063 not applied yet) is a normal state: reads
// answer { available: false } and writes refuse with `private_unavailable`,
// so everything public keeps working (contracts §3).
//
// Optimistic concurrency: every row carries `version`. A write names the
// version it read (null = "there is no row yet") and is refused as
// `conflict` when the row moved on.

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { PERSON_CONTACT_KINDS, type PersonContactKind } from '@/lib/modules/people/model'
import { PersonError, UUID_RE } from './persons-lifecycle'

/** A private contact method — the same shape as the public personContact. */
export interface PersonPrivateContact {
  _key: string
  kind: PersonContactKind
  value: string
  label: string
  preferred: boolean
}

export interface PersonPrivateRow {
  contacts: PersonPrivateContact[]
  /** YYYY-MM-DD or null (optional, empty by default — D2). */
  birthday: string | null
  notes: string | null
  version: number
  updatedAt: string | null
}

export type PersonPrivateRead = { available: false } | { available: true; row: PersonPrivateRow | null }

export interface PersonPrivateWrite {
  contacts?: PersonPrivateContact[]
  birthday?: string | null
  notes?: string | null
}

export interface PersonPrivateStore {
  read(projectId: string, publicId: string): Promise<PersonPrivateRead>
  /**
   * Creates (expectedVersion null) or updates (expectedVersion = the version
   * read) the row. Fields left out are kept. Returns the stored row.
   */
  save(projectId: string, publicId: string, input: PersonPrivateWrite, expectedVersion: number | null): Promise<PersonPrivateRow>
  /** Removes the row (anonymise, delete). true when the table exists (row or not), false when it is missing. */
  remove(projectId: string, publicId: string): Promise<boolean>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PersonPrivateDb = { from: (table: 'person_private') => any }

const REASON = 'ADR-043 People: server-only person_private (migration 063)'
const COLUMNS = 'contacts, birthday, notes, version, updated_at'

/** Postgres 42P01 / PostgREST PGRST205: the table is not there (migration 063 not applied). */
export function isMissingPersonPrivateTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /relation .*person_private.* does not exist/i.test(m) || /could not find the table .*person_private/i.test(m)
}

const KINDS = new Set<string>(PERSON_CONTACT_KINDS)

function contactsOf(value: unknown): PersonPrivateContact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const c = raw as Record<string, unknown> | null
    if (!c || typeof c !== 'object' || typeof c._key !== 'string' || !KINDS.has(String(c.kind)) || typeof c.value !== 'string') return []
    return [{ _key: c._key, kind: c.kind as PersonContactKind, value: c.value, label: typeof c.label === 'string' ? c.label : '', preferred: c.preferred === true }]
  })
}

function rowOf(r: Record<string, unknown>): PersonPrivateRow {
  return {
    contacts: contactsOf(r.contacts),
    birthday: typeof r.birthday === 'string' && r.birthday ? r.birthday.slice(0, 10) : null,
    notes: typeof r.notes === 'string' && r.notes ? r.notes : null,
    version: Number(r.version) || 1,
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : null,
  }
}

function assertIds(projectId: string, publicId: string) {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(publicId)) throw new PersonError('not_found', 'Unknown person.')
}

const unavailable = () => new PersonError('private_unavailable', 'Private details cannot be stored yet.')

export function createSupabasePersonPrivateStore(dbOverride?: PersonPrivateDb): PersonPrivateStore {
  const configured = () => Boolean(dbOverride) || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  const withDb = <T>(fn: (db: PersonPrivateDb) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as PersonPrivateDb))

  return {
    read: async (projectId, publicId) => {
      assertIds(projectId, publicId)
      if (!configured()) return { available: false }
      try {
        return await withDb(async (db) => {
          const { data, error } = await db.from('person_private').select(COLUMNS).eq('project_id', projectId).eq('person_public_id', publicId).maybeSingle()
          if (isMissingPersonPrivateTable(error)) return { available: false } as const
          if (error) throw new PersonError('failed', 'Could not read the private details.')
          return { available: true, row: data ? rowOf(data as Record<string, unknown>) : null } as const
        })
      } catch (error) {
        if (error instanceof PersonError) throw error
        throw new PersonError('failed', 'Could not read the private details.')
      }
    },

    save: async (projectId, publicId, input, expectedVersion) => {
      assertIds(projectId, publicId)
      if (!configured()) throw unavailable()
      const fields: Record<string, unknown> = {}
      if (input.contacts !== undefined) fields.contacts = input.contacts
      if (input.birthday !== undefined) fields.birthday = input.birthday
      if (input.notes !== undefined) fields.notes = input.notes
      return withDb(async (db) => {
        if (expectedVersion === null) {
          const { data, error } = await db
            .from('person_private')
            .insert({ project_id: projectId, person_public_id: publicId, contacts: [], ...fields, version: 1 })
            .select(COLUMNS)
            .single()
          if (isMissingPersonPrivateTable(error)) throw unavailable()
          if (error?.code === '23505') throw new PersonError('conflict', 'The private details were changed elsewhere.')
          if (error || !data) throw new PersonError('failed', 'Could not save the private details.')
          return rowOf(data as Record<string, unknown>)
        }
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new PersonError('conflict', 'Missing version.')
        const { data, error } = await db
          .from('person_private')
          .update({ ...fields, version: expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('person_public_id', publicId)
          .eq('version', expectedVersion)
          .select(COLUMNS)
        if (isMissingPersonPrivateTable(error)) throw unavailable()
        if (error) throw new PersonError('failed', 'Could not save the private details.')
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new PersonError('conflict', 'The private details were changed elsewhere.')
        return rowOf(row as Record<string, unknown>)
      })
    },

    remove: async (projectId, publicId) => {
      assertIds(projectId, publicId)
      if (!configured()) return false
      return withDb(async (db) => {
        const { error } = await db.from('person_private').delete().eq('project_id', projectId).eq('person_public_id', publicId)
        if (isMissingPersonPrivateTable(error)) return false
        if (error) throw new PersonError('failed', 'Could not remove the private details.')
        return true
      })
    },
  }
}
