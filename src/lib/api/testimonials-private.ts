// Server-only: service role; never import from a client component.
// ── Testimonials — the private store (Supabase testimonial_private, migration 067) ──
//
// The ONLY code that talks to public.testimonial_private (ADR-048 D3, the
// persons-private.ts pattern). Every read and write is scoped by project_id; the
// table is server-only (RLS on, no grants to anon/authenticated). Authorisation
// is the caller's job (testimonials.ts runs assertModuleAction first).
//
// "Table missing" (migration 067 not applied yet) is a normal state: reads
// answer { available: false } and writes refuse with `private_unavailable`, so
// everything public keeps working.
//
// Optimistic concurrency: every row carries `version`. A write names the version
// it read (null = "there is no row yet") and is refused as `conflict` when the
// row moved on.

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { TestimonialError } from './testimonials-lifecycle'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const TESTIMONIAL_PRIVATE_LIMITS = { fullName: 200, email: 320, phone: 60, note: 5000 } as const

export interface TestimonialPrivateRow {
  fullName: string | null
  email: string | null
  phone: string | null
  note: string | null
  /** The form submission this testimonial was created from, if any. */
  submissionId: string | null
  /** When permission to publish was ticked (ISO), set by the server. */
  permissionGivenAt: string | null
  version: number
  updatedAt: string | null
}

export type TestimonialPrivateRead = { available: false } | { available: true; row: TestimonialPrivateRow | null }

/** Fields left out are kept; `null` clears. */
export interface TestimonialPrivateWrite {
  fullName?: string | null
  email?: string | null
  phone?: string | null
  note?: string | null
  submissionId?: string | null
  permissionGivenAt?: string | null
}

export interface TestimonialPrivateStore {
  read(projectId: string, publicId: string): Promise<TestimonialPrivateRead>
  /** Many at once (the list shows who said it to people who may see it). Missing table → { available: false }. */
  readMany(projectId: string, publicIds: readonly string[]): Promise<{ available: false } | { available: true; rows: Map<string, TestimonialPrivateRow> }>
  /** Which testimonials were created from which submissions: submissionId → testimonial publicId. */
  bySubmissions(projectId: string, submissionIds: readonly string[]): Promise<{ available: false } | { available: true; links: Map<string, string> }>
  /**
   * Creates (expectedVersion null) or updates (expectedVersion = the version
   * read) the row. Fields left out are kept. Returns the stored row.
   */
  save(projectId: string, publicId: string, input: TestimonialPrivateWrite, expectedVersion: number | null): Promise<TestimonialPrivateRow>
  /** Removes the row (permanent delete). true when the table exists (row or not), false when it is missing. */
  remove(projectId: string, publicId: string): Promise<boolean>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestimonialPrivateDb = { from: (table: 'testimonial_private') => any }

const REASON = 'ADR-048 Testimonials: server-only testimonial_private (migration 067)'
const COLUMNS = 'testimonial_public_id, full_name, email, phone, note, submission_id, permission_given_at, version, updated_at'

/** Postgres 42P01 / PostgREST PGRST205: the table is not there (migration 067 not applied). */
export function isMissingTestimonialPrivateTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /relation .*testimonial_private.* does not exist/i.test(m) || /could not find the table .*testimonial_private/i.test(m)
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function rowOf(r: Record<string, unknown>): TestimonialPrivateRow {
  return {
    fullName: text(r.full_name),
    email: text(r.email),
    phone: text(r.phone),
    note: text(r.note),
    submissionId: text(r.submission_id),
    permissionGivenAt: text(r.permission_given_at),
    version: Number(r.version) || 1,
    updatedAt: text(r.updated_at),
  }
}

function assertIds(projectId: string, publicId: string) {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(publicId)) throw new TestimonialError('not_found', 'Unknown testimonial.')
}

const unavailable = () => new TestimonialError('private_unavailable', 'Private details cannot be stored yet.')

function columnsOf(input: TestimonialPrivateWrite): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (input.fullName !== undefined) fields.full_name = input.fullName
  if (input.email !== undefined) fields.email = input.email
  if (input.phone !== undefined) fields.phone = input.phone
  if (input.note !== undefined) fields.note = input.note
  if (input.submissionId !== undefined) fields.submission_id = input.submissionId
  if (input.permissionGivenAt !== undefined) fields.permission_given_at = input.permissionGivenAt
  return fields
}

export function createSupabaseTestimonialPrivateStore(dbOverride?: TestimonialPrivateDb): TestimonialPrivateStore {
  const configured = () => Boolean(dbOverride) || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  const withDb = <T>(fn: (db: TestimonialPrivateDb) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as TestimonialPrivateDb))

  return {
    read: async (projectId, publicId) => {
      assertIds(projectId, publicId)
      if (!configured()) return { available: false }
      try {
        return await withDb(async (db) => {
          const { data, error } = await db.from('testimonial_private').select(COLUMNS).eq('project_id', projectId).eq('testimonial_public_id', publicId).maybeSingle()
          if (isMissingTestimonialPrivateTable(error)) return { available: false } as const
          if (error) throw new TestimonialError('failed', 'Could not read the private details.')
          return { available: true, row: data ? rowOf(data as Record<string, unknown>) : null } as const
        })
      } catch (error) {
        if (error instanceof TestimonialError) throw error
        throw new TestimonialError('failed', 'Could not read the private details.')
      }
    },

    readMany: async (projectId, publicIds) => {
      if (!UUID_RE.test(projectId)) throw new TestimonialError('not_found', 'Unknown project.')
      const ids = [...new Set(publicIds.filter((id) => UUID_RE.test(id)))]
      if (!configured()) return { available: false }
      if (!ids.length) return { available: true, rows: new Map() }
      try {
        return await withDb(async (db) => {
          const { data, error } = await db.from('testimonial_private').select(COLUMNS).eq('project_id', projectId).in('testimonial_public_id', ids)
          if (isMissingTestimonialPrivateTable(error)) return { available: false } as const
          if (error) throw new TestimonialError('failed', 'Could not read the private details.')
          const rows = new Map<string, TestimonialPrivateRow>()
          for (const r of (data ?? []) as Array<Record<string, unknown>>) {
            if (typeof r.testimonial_public_id === 'string') rows.set(r.testimonial_public_id, rowOf(r))
          }
          return { available: true, rows } as const
        })
      } catch (error) {
        if (error instanceof TestimonialError) throw error
        throw new TestimonialError('failed', 'Could not read the private details.')
      }
    },

    bySubmissions: async (projectId, submissionIds) => {
      if (!UUID_RE.test(projectId)) throw new TestimonialError('not_found', 'Unknown project.')
      const ids = [...new Set(submissionIds.filter((id) => UUID_RE.test(id)))]
      if (!configured()) return { available: false }
      if (!ids.length) return { available: true, links: new Map() }
      try {
        return await withDb(async (db) => {
          const { data, error } = await db.from('testimonial_private').select('testimonial_public_id, submission_id').eq('project_id', projectId).in('submission_id', ids)
          if (isMissingTestimonialPrivateTable(error)) return { available: false } as const
          if (error) throw new TestimonialError('failed', 'Could not read the private details.')
          const links = new Map<string, string>()
          for (const r of (data ?? []) as Array<Record<string, unknown>>) {
            if (typeof r.submission_id === 'string' && typeof r.testimonial_public_id === 'string') links.set(r.submission_id, r.testimonial_public_id)
          }
          return { available: true, links } as const
        })
      } catch (error) {
        if (error instanceof TestimonialError) throw error
        throw new TestimonialError('failed', 'Could not read the private details.')
      }
    },

    save: async (projectId, publicId, input, expectedVersion) => {
      assertIds(projectId, publicId)
      if (!configured()) throw unavailable()
      const fields = columnsOf(input)
      return withDb(async (db) => {
        if (expectedVersion === null) {
          const { data, error } = await db
            .from('testimonial_private')
            .insert({ project_id: projectId, testimonial_public_id: publicId, ...fields, version: 1 })
            .select(COLUMNS)
            .single()
          if (isMissingTestimonialPrivateTable(error)) throw unavailable()
          if (error?.code === '23505') throw new TestimonialError('conflict', 'The private details were changed elsewhere.')
          if (error || !data) throw new TestimonialError('failed', 'Could not save the private details.')
          return rowOf(data as Record<string, unknown>)
        }
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TestimonialError('conflict', 'Missing version.')
        const { data, error } = await db
          .from('testimonial_private')
          .update({ ...fields, version: expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('testimonial_public_id', publicId)
          .eq('version', expectedVersion)
          .select(COLUMNS)
        if (isMissingTestimonialPrivateTable(error)) throw unavailable()
        if (error) throw new TestimonialError('failed', 'Could not save the private details.')
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new TestimonialError('conflict', 'The private details were changed elsewhere.')
        return rowOf(row as Record<string, unknown>)
      })
    },

    remove: async (projectId, publicId) => {
      assertIds(projectId, publicId)
      if (!configured()) return false
      return withDb(async (db) => {
        const { error } = await db.from('testimonial_private').delete().eq('project_id', projectId).eq('testimonial_public_id', publicId)
        if (isMissingTestimonialPrivateTable(error)) return false
        if (error) throw new TestimonialError('failed', 'Could not remove the private details.')
        return true
      })
    },
  }
}
