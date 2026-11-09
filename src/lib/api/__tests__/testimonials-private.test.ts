/**
 * The private store (Supabase testimonial_private, migration 067): the contract
 * the services rely on — scoped by project, "table missing" is a normal state,
 * optimistic concurrency, nothing private outside this file.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { createSupabaseTestimonialPrivateStore, isMissingTestimonialPrivateTable, rowOf, type TestimonialPrivateDb } from '../testimonials-private'
import { TestimonialError } from '../testimonials-lifecycle'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PROJECT = '00000000-0000-4000-8000-0000000000aa'
const PUBLIC = '11111111-1111-4111-8111-111111111111'
const SUB = '33333333-3333-4333-8333-333333333333'

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/** A chainable fake: every builder method records, the terminal call (await / single / maybeSingle) resolves `result`. */
function fakeDb(result: Result | ((op: string[]) => Result)) {
  const ops: Array<{ table: string; chain: Array<[string, unknown[]]> }> = []
  const db: TestimonialPrivateDb = {
    from: (table) => {
      const entry = { table, chain: [] as Array<[string, unknown[]]> }
      ops.push(entry)
      const resolve = () => {
        const r = typeof result === 'function' ? result(entry.chain.map((c) => c[0])) : result
        return { data: r.data ?? null, error: r.error ?? null }
      }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in']) q[m] = (...a: unknown[]) => (entry.chain.push([m, a]), q)
      q.single = async () => (entry.chain.push(['single', []]), resolve())
      q.maybeSingle = async () => (entry.chain.push(['maybeSingle', []]), resolve())
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko)
      return q
    },
  }
  return { db, ops }
}

const row = (o: Record<string, unknown> = {}) => ({
  testimonial_public_id: PUBLIC,
  full_name: 'Anna Bianchi',
  email: 'a@b.it',
  phone: null,
  note: '',
  submission_id: SUB,
  permission_given_at: '2026-11-08T10:00:00Z',
  version: 2,
  updated_at: '2026-11-08T11:00:00Z',
  ...o,
})
const missing = { error: { code: '42P01', message: 'relation "public.testimonial_private" does not exist' } }

describe('missing table is a normal state', () => {
  it.each([
    [{ code: '42P01' }],
    [{ code: 'PGRST205' }],
    [{ message: 'relation "public.testimonial_private" does not exist' }],
    [{ message: "Could not find the table 'public.testimonial_private' in the schema cache" }],
  ])('%j is recognised', (e) => expect(isMissingTestimonialPrivateTable(e)).toBe(true))
  it('other errors are not', () => {
    expect(isMissingTestimonialPrivateTable({ code: '23505' })).toBe(false)
    expect(isMissingTestimonialPrivateTable(null)).toBe(false)
  })

  it('read → { available: false }; readMany / bySubmissions likewise; remove → false', async () => {
    const { db } = fakeDb(missing)
    const s = createSupabaseTestimonialPrivateStore(db)
    expect(await s.read(PROJECT, PUBLIC)).toEqual({ available: false })
    expect(await s.readMany(PROJECT, [PUBLIC])).toEqual({ available: false })
    expect(await s.bySubmissions(PROJECT, [SUB])).toEqual({ available: false })
    expect(await s.remove(PROJECT, PUBLIC)).toBe(false)
  })

  it('writes refuse with private_unavailable', async () => {
    const s = createSupabaseTestimonialPrivateStore(fakeDb(missing).db)
    await expect(s.save(PROJECT, PUBLIC, { note: 'x' }, null)).rejects.toMatchObject({ code: 'private_unavailable' })
    await expect(s.save(PROJECT, PUBLIC, { note: 'x' }, 1)).rejects.toMatchObject({ code: 'private_unavailable' })
  })

  it('without Supabase configured nothing is available and nothing is written', async () => {
    const s = createSupabaseTestimonialPrivateStore()
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    try {
      expect(await s.read(PROJECT, PUBLIC)).toEqual({ available: false })
      await expect(s.save(PROJECT, PUBLIC, {}, null)).rejects.toMatchObject({ code: 'private_unavailable' })
    } finally {
      if (saved.url) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url
      if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key
    }
  })
})

describe('read', () => {
  it('is scoped by project AND testimonial, and maps columns', async () => {
    const { db, ops } = fakeDb({ data: row() })
    const r = await createSupabaseTestimonialPrivateStore(db).read(PROJECT, PUBLIC)
    expect(r).toEqual({
      available: true,
      row: { fullName: 'Anna Bianchi', email: 'a@b.it', phone: null, note: null, submissionId: SUB, permissionGivenAt: '2026-11-08T10:00:00Z', version: 2, updatedAt: '2026-11-08T11:00:00Z' },
    })
    expect(ops[0].table).toBe('testimonial_private')
    expect(ops[0].chain).toContainEqual(['eq', ['project_id', PROJECT]])
    expect(ops[0].chain).toContainEqual(['eq', ['testimonial_public_id', PUBLIC]])
  })
  it('no row is { available: true, row: null }', async () => {
    expect(await createSupabaseTestimonialPrivateStore(fakeDb({ data: null }).db).read(PROJECT, PUBLIC)).toEqual({ available: true, row: null })
  })
  it('a database error is "failed", never a leak', async () => {
    await expect(createSupabaseTestimonialPrivateStore(fakeDb({ error: { code: 'XX000', message: 'boom with secrets' } }).db).read(PROJECT, PUBLIC)).rejects.toMatchObject({ code: 'failed', message: 'Could not read the private details.' })
  })
  it('refuses ids that are not UUIDs before any query', async () => {
    const { db, ops } = fakeDb({ data: null })
    const s = createSupabaseTestimonialPrivateStore(db)
    await expect(s.read('not-a-uuid', PUBLIC)).rejects.toBeInstanceOf(TestimonialError)
    await expect(s.read(PROJECT, "x'; drop table")).rejects.toMatchObject({ code: 'not_found' })
    await expect(s.save(PROJECT, 'nope', {}, null)).rejects.toMatchObject({ code: 'not_found' })
    await expect(s.remove('nope', PUBLIC)).rejects.toMatchObject({ code: 'not_found' })
    expect(ops).toEqual([])
  })
  it('readMany / bySubmissions are scoped by project and drop non-UUID ids', async () => {
    const a = fakeDb({ data: [row()] })
    const r = await createSupabaseTestimonialPrivateStore(a.db).readMany(PROJECT, [PUBLIC, 'junk', PUBLIC])
    expect(r.available && [...r.rows.keys()]).toEqual([PUBLIC])
    expect(a.ops[0].chain).toContainEqual(['eq', ['project_id', PROJECT]])
    expect(a.ops[0].chain).toContainEqual(['in', ['testimonial_public_id', [PUBLIC]]])
    const b = fakeDb({ data: [{ testimonial_public_id: PUBLIC, submission_id: SUB }] })
    const l = await createSupabaseTestimonialPrivateStore(b.db).bySubmissions(PROJECT, [SUB, 'junk'])
    expect(l.available && [...l.links]).toEqual([[SUB, PUBLIC]])
    expect(b.ops[0].chain).toContainEqual(['in', ['submission_id', [SUB]]])
    const none = fakeDb({ data: [] })
    expect(await createSupabaseTestimonialPrivateStore(none.db).readMany(PROJECT, ['junk'])).toEqual({ available: true, rows: new Map() })
    expect(none.ops).toEqual([])
  })
})

describe('save — optimistic concurrency', () => {
  it('creates at version 1 when there is no row yet, writing only what it is given', async () => {
    const { db, ops } = fakeDb({ data: row({ version: 1 }) })
    const saved = await createSupabaseTestimonialPrivateStore(db).save(PROJECT, PUBLIC, { fullName: 'Anna', permissionGivenAt: '2026-11-08T10:00:00Z' }, null)
    expect(saved.version).toBe(1)
    const insert = ops[0].chain.find((c) => c[0] === 'insert')![1][0] as Record<string, unknown>
    expect(insert).toEqual({ project_id: PROJECT, testimonial_public_id: PUBLIC, full_name: 'Anna', permission_given_at: '2026-11-08T10:00:00Z', version: 1 })
  })
  it('a duplicate create is a conflict', async () => {
    await expect(createSupabaseTestimonialPrivateStore(fakeDb({ error: { code: '23505' } }).db).save(PROJECT, PUBLIC, {}, null)).rejects.toMatchObject({ code: 'conflict' })
  })
  it('updates only the version it read; leaves out what is not given; null clears', async () => {
    const { db, ops } = fakeDb({ data: [row({ version: 3 })] })
    const saved = await createSupabaseTestimonialPrivateStore(db).save(PROJECT, PUBLIC, { note: null, email: 'x@y.it' }, 2)
    expect(saved.version).toBe(3)
    const update = ops[0].chain.find((c) => c[0] === 'update')![1][0] as Record<string, unknown>
    expect(update).toMatchObject({ note: null, email: 'x@y.it', version: 3 })
    expect(update).not.toHaveProperty('full_name')
    expect(ops[0].chain).toContainEqual(['eq', ['version', 2]])
    expect(ops[0].chain).toContainEqual(['eq', ['project_id', PROJECT]])
  })
  it('a row that moved on (no row matched) is a conflict; a bad version is a conflict', async () => {
    const s = createSupabaseTestimonialPrivateStore(fakeDb({ data: [] }).db)
    await expect(s.save(PROJECT, PUBLIC, { note: 'x' }, 2)).rejects.toMatchObject({ code: 'conflict' })
    await expect(s.save(PROJECT, PUBLIC, { note: 'x' }, 0)).rejects.toMatchObject({ code: 'conflict' })
    await expect(s.save(PROJECT, PUBLIC, { note: 'x' }, 1.5)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('remove', () => {
  it('deletes by project and testimonial; true when the table exists', async () => {
    const { db, ops } = fakeDb({})
    expect(await createSupabaseTestimonialPrivateStore(db).remove(PROJECT, PUBLIC)).toBe(true)
    expect(ops[0].chain.map((c) => c[0])).toEqual(['delete', 'eq', 'eq'])
    expect(ops[0].chain).toContainEqual(['eq', ['project_id', PROJECT]])
  })
  it('a database error is "failed"', async () => {
    await expect(createSupabaseTestimonialPrivateStore(fakeDb({ error: { code: 'XX000' } }).db).remove(PROJECT, PUBLIC)).rejects.toMatchObject({ code: 'failed' })
  })
})

describe('rowOf', () => {
  it('empty strings become null and a missing version 1', () => {
    expect(rowOf({ full_name: '', email: undefined, version: undefined })).toMatchObject({ fullName: null, email: null, version: 1 })
  })
})

describe('migration 067', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/067_testimonial_private.sql'), 'utf8')
  it('is NOT APPLIED, has a rollback and a CHECK block (063 style)', () => {
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).toMatch(/Rollback \(refuses once rows exist\)/)
    expect(sql).toMatch(/CHECK — run after applying/)
  })
  it('is server-only, unique per project + testimonial, cascades with the project', () => {
    expect(sql).toMatch(/primary key \(project_id, testimonial_public_id\)/)
    expect(sql).toMatch(/project_id\s+uuid not null references public\.projects \(id\) on delete cascade/)
    expect(sql).toMatch(/submission_id\s+uuid references public\.form_submissions \(id\) on delete set null/)
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/revoke all on public\.testimonial_private from public, anon, authenticated, service_role/)
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated)/i)
    expect(sql).not.toMatch(/create policy/i)
  })
  it('has every column the store reads', () => {
    for (const c of ['full_name', 'email', 'phone', 'note', 'submission_id', 'permission_given_at', 'version', 'created_at', 'updated_at']) expect(sql, c).toContain(c)
  })
})
