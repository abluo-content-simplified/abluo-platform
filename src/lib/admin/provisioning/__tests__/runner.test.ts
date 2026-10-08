/**
 * The provisioning runner against in-memory fakes of Supabase and Sanity:
 * ordered steps, progress saved per step, a failure stops the run at that
 * step, Retry resumes there without repeating finished steps, conflicts are
 * reported (never overwritten), and a running run cannot be claimed twice.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runProvisioning, type RunnerDeps, type SanityWriter } from '../runner'
import { planProvisioning } from '../plan'
import { PROVISION_STEPS, validateWizardInput } from '../model'
import { RUNS_TABLE, type RunRow } from '../store'

type Row = Record<string, unknown>
type Err = { code?: string; message: string } | null

/** Just enough of supabase-js's query builder for store.ts and runner.ts. */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { tenants: [], projects: [], [RUNS_TABLE]: [], ...seed }
  const failNextInsert: Record<string, Err> = {}
  let clock = Date.parse('2026-10-08T10:00:00Z')
  const tick = () => new Date((clock += 1000)).toISOString()

  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const filters: ((r: Row) => boolean)[] = []
    let returning = false
    let mode: 'many' | 'single' | 'maybe' = 'many'
    const rows = () => (tables[table] ??= [])

    const exec = (): { data: unknown; error: Err } => {
      if (op === 'insert') {
        const injected = failNextInsert[table]
        if (injected) {
          delete failNextInsert[table]
          return { data: null, error: injected }
        }
        const row = { id: crypto.randomUUID(), created_at: tick(), updated_at: tick(), ...payload }
        if (table === RUNS_TABLE) Object.assign(row, { status: 'pending', steps: {}, attempts: 0, current_step: null, last_error: null, completed_at: null, ...payload })
        rows().push(row)
        return { data: returning ? (mode === 'many' ? [row] : row) : null, error: null }
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload, table === RUNS_TABLE ? { updated_at: tick() } : {})
        if (!returning) return { data: null, error: null }
      }
      const copy = hit.map((r) => JSON.parse(JSON.stringify(r)))
      if (mode === 'many') return { data: copy, error: null }
      return { data: copy[0] ?? null, error: null }
    }

    const b = {
      select: () => ((returning = true), b),
      insert: (row: Row) => ((op = 'insert'), (payload = row), b),
      update: (patch: Row) => ((op = 'update'), (payload = patch), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      or: (expr: string) => {
        const before = expr.match(/updated_at\.lt\."([^"]+)"/)?.[1] ?? ''
        filters.push((r) => r.status === 'pending' || r.status === 'failed' || (r.status === 'running' && String(r.updated_at) < before))
        return b
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => ((mode = 'maybe'), b),
      single: () => ((mode = 'single'), b),
      then: (resolve: (v: { data: unknown; error: Err }) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(exec).then(resolve, reject),
    }
    return b
  }
  return { client: { from: builder } as unknown as SupabaseClient, tables, failNextInsert }
}

function fakeSanity(seed: Row[] = []) {
  const docs = new Map<string, Row>(seed.map((d) => [d._id as string, d]))
  const created: string[] = []
  const failOnce = new Set<string>()
  const sanity: SanityWriter = {
    getDocument: async (id) => (docs.has(id) ? { ...docs.get(id)! } : undefined),
    createIfNotExists: async (doc) => {
      if (failOnce.has(doc._id)) {
        failOnce.delete(doc._id)
        throw new Error(`Sanity: network error on ${doc._id}`)
      }
      if (!docs.has(doc._id)) {
        docs.set(doc._id, doc)
        created.push(doc._id)
      }
      return doc
    },
  }
  return { sanity, docs, created, failOnce }
}

const TENANT = '7d1f2a40-1111-4abc-8def-000000000001'
const PROJECT = '7d1f2a40-2222-4abc-8def-000000000002'

function newRun(db: ReturnType<typeof fakeDb>, patch: Partial<RunRow> = {}) {
  const v = validateWizardInput({
    client: { mode: 'new', name: 'Studio Rossi', slug: 'studio-rossi' },
    project: { name: 'Studio Rossi', slug: 'rossi', defaultLocale: 'it', supportedLocales: ['it'] },
    designSystemId: 'abluo-base-design-system',
    owner: { name: 'Paola Rossi', email: 'paola@example.com' },
  })
  if (!v.ok) throw new Error('fixture')
  const plan = planProvisioning(v.value, {
    tenantId: TENANT,
    projectId: PROJECT,
    tenant: { slug: 'studio-rossi', name: 'Studio Rossi' },
    existingClientDocId: null,
    designSystem: { _id: 'abluo-base-design-system', role: 'template' },
  })
  const row = {
    id: '7d1f2a40-3333-4abc-8def-000000000003',
    status: 'pending',
    tenant_mode: 'new',
    tenant_id: TENANT,
    tenant_slug: 'studio-rossi',
    project_id: PROJECT,
    project_slug: 'rossi',
    input: {},
    plan,
    steps: {},
    current_step: null,
    last_error: null,
    attempts: 0,
    created_by: null,
    created_at: '2026-10-08T09:00:00Z',
    updated_at: '2026-10-08T09:00:00Z',
    completed_at: null,
    ...patch,
  }
  db.tables[RUNS_TABLE].push(row)
  return row
}

function deps(db: ReturnType<typeof fakeDb>, s: ReturnType<typeof fakeSanity>, inviteOwner = vi.fn(async () => ({ ok: true as const, invitationId: 'inv-1', emailSent: true }))): RunnerDeps & { inviteOwner: typeof inviteOwner } {
  return { db: db.client, sanity: s.sanity, inviteOwner, now: () => new Date('2026-10-08T10:30:00Z') }
}

describe('runProvisioning', () => {
  it('runs every step in order and completes', async () => {
    const db = fakeDb()
    const s = fakeSanity()
    const run = newRun(db)
    const d = deps(db, s)
    const r = await runProvisioning(run.id, d)
    expect(r.ok && r.row.status).toBe('completed')
    expect(db.tables.tenants).toMatchObject([{ id: TENANT, slug: 'studio-rossi', display_name: 'Studio Rossi' }])
    expect(db.tables.projects).toMatchObject([{ id: PROJECT, slug: 'rossi', tenant_id: TENANT, status: 'preview' }])
    expect(s.created).toEqual(['client-studio-rossi', 'ds-rossi', 'project-rossi', 'siteconfig-rossi', 'page-rossi-home'])
    expect(d.inviteOwner).toHaveBeenCalledTimes(1)
    expect(d.inviteOwner).toHaveBeenCalledWith({ email: 'paola@example.com', name: 'Paola Rossi', role: 'owner', locale: 'it' }, TENANT)
    const saved = db.tables[RUNS_TABLE][0] as RunRow
    expect(saved.status).toBe('completed')
    expect(saved.completed_at).toBeTruthy()
    expect(Object.keys(saved.steps)).toEqual([...PROVISION_STEPS])
    expect(saved.steps['invite.owner']?.result).toEqual({ invitationId: 'inv-1', emailSent: true })
    expect(saved.attempts).toBe(1)
  })

  it('stops at the failing step, then Retry resumes there without repeating finished steps', async () => {
    const db = fakeDb()
    const s = fakeSanity()
    s.failOnce.add('project-rossi')
    const run = newRun(db)
    const d = deps(db, s)

    const first = await runProvisioning(run.id, d)
    expect(first.ok && first.row.status).toBe('failed')
    let saved = db.tables[RUNS_TABLE][0] as RunRow
    expect(saved.status).toBe('failed')
    expect(saved.current_step).toBe('sanity.project')
    expect(saved.last_error).toMatch(/^sanity\.project: Sanity: network error/)
    expect(saved.steps['sanity.project']).toMatchObject({ status: 'failed', error: 'failed' })
    expect(saved.steps['sanity.designSystem']?.status).toBe('done')
    expect(saved.steps['sanity.siteConfig']).toBeUndefined()
    expect(d.inviteOwner).not.toHaveBeenCalled()

    const second = await runProvisioning(run.id, d)
    expect(second.ok && second.row.status).toBe('completed')
    saved = db.tables[RUNS_TABLE][0] as RunRow
    expect(saved.attempts).toBe(2)
    expect(db.tables.tenants).toHaveLength(1)
    expect(db.tables.projects).toHaveLength(1)
    expect(s.created).toEqual(['client-studio-rossi', 'ds-rossi', 'project-rossi', 'siteconfig-rossi', 'page-rossi-home'])
    expect(d.inviteOwner).toHaveBeenCalledTimes(1)
  })

  it('a step whose record was lost is re-verified, not duplicated (idempotent)', async () => {
    const db = fakeDb()
    const s = fakeSanity()
    const run = newRun(db)
    await runProvisioning(run.id, deps(db, s))
    // Forget the progress, as if the run record had not been saved.
    Object.assign(db.tables[RUNS_TABLE][0], { status: 'failed', steps: {}, completed_at: null })
    const d = deps(db, s)
    const again = await runProvisioning(run.id, d)
    expect(again.ok && again.row.status).toBe('completed')
    expect(db.tables.tenants).toHaveLength(1)
    expect(db.tables.projects).toHaveLength(1)
    expect(s.created).toHaveLength(5)
    expect((db.tables[RUNS_TABLE][0] as RunRow).steps['sanity.project']?.result).toEqual({ existed: true })
  })

  it('reports a conflict instead of touching a document that belongs to another project', async () => {
    const db = fakeDb()
    const s = fakeSanity([{ _id: 'ds-rossi', _type: 'designSystem', projectSlug: 'someone-else' }])
    const run = newRun(db)
    const r = await runProvisioning(run.id, deps(db, s))
    expect(r.ok && r.row.status).toBe('failed')
    const saved = db.tables[RUNS_TABLE][0] as RunRow
    expect(saved.steps['sanity.designSystem']).toMatchObject({ status: 'failed', error: 'conflict' })
    expect(s.docs.get('ds-rossi')).toEqual({ _id: 'ds-rossi', _type: 'designSystem', projectSlug: 'someone-else' })
  })

  it('reports a conflict when the slug was taken meanwhile (unique violation)', async () => {
    const db = fakeDb()
    db.failNextInsert.projects = { code: '23505', message: 'duplicate key value violates unique constraint "projects_tenant_id_slug_key"' }
    const run = newRun(db)
    const r = await runProvisioning(run.id, deps(db, fakeSanity()))
    expect(r.ok && r.row.status).toBe('failed')
    expect((db.tables[RUNS_TABLE][0] as RunRow).steps['supabase.project']).toMatchObject({ status: 'failed', error: 'conflict' })
  })

  it('a project row with the planned id but another client is a conflict, never adopted', async () => {
    const db = fakeDb({ projects: [{ id: PROJECT, slug: 'rossi', tenant_id: 'another-tenant' }] })
    const run = newRun(db)
    await runProvisioning(run.id, deps(db, fakeSanity()))
    expect((db.tables[RUNS_TABLE][0] as RunRow).steps['supabase.project']).toMatchObject({ status: 'failed', error: 'conflict' })
  })

  it('a failed invitation fails the last step and Retry sends it', async () => {
    const db = fakeDb()
    const s = fakeSanity()
    const run = newRun(db)
    const invite = vi.fn().mockResolvedValueOnce({ ok: false, error: 'failed' }).mockResolvedValueOnce({ ok: true, invitationId: 'inv-2', emailSent: false })
    const d = { ...deps(db, s), inviteOwner: invite }
    expect((await runProvisioning(run.id, d)).ok && (db.tables[RUNS_TABLE][0] as RunRow).status).toBe('failed')
    expect((db.tables[RUNS_TABLE][0] as RunRow).current_step).toBe('invite.owner')
    await runProvisioning(run.id, d)
    const saved = db.tables[RUNS_TABLE][0] as RunRow
    expect(saved.status).toBe('completed')
    expect(saved.steps['invite.owner']?.result).toEqual({ invitationId: 'inv-2', emailSent: false })
    expect(s.created).toHaveLength(5)
  })

  it('a run already running (and not stale) is not claimed twice', async () => {
    const db = fakeDb()
    const run = newRun(db, { status: 'running', updated_at: '2026-10-08T10:29:30Z' })
    const r = await runProvisioning(run.id, deps(db, fakeSanity()))
    expect(r).toMatchObject({ ok: false, error: 'busy' })
  })

  it('a running run whose request died (stale) is claimed again', async () => {
    const db = fakeDb()
    const run = newRun(db, { status: 'running', updated_at: '2026-10-08T10:00:00Z' })
    const r = await runProvisioning(run.id, deps(db, fakeSanity()))
    expect(r.ok && r.row.status).toBe('completed')
  })

  it('a completed run is returned as is, with no writes', async () => {
    const db = fakeDb()
    const s = fakeSanity()
    const run = newRun(db, { status: 'completed', completed_at: '2026-10-08T09:30:00Z' })
    const d = deps(db, s)
    const r = await runProvisioning(run.id, d)
    expect(r.ok && r.row.status).toBe('completed')
    expect(s.created).toEqual([])
    expect(d.inviteOwner).not.toHaveBeenCalled()
  })

  it('an unknown run is not found', async () => {
    const r = await runProvisioning('7d1f2a40-9999-4abc-8def-000000000009', deps(fakeDb(), fakeSanity()))
    expect(r).toEqual({ ok: false, error: 'not_found' })
  })
})
