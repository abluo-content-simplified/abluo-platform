/**
 * Testimonial submissions (ADR-048 D4): the inbox, create-from-submission and
 * the exclusion from the general Contact requests.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/support/data-client', () => ({ projectDataClient: vi.fn() }))

import {
  createTestimonialFromSubmission,
  listTestimonialSubmissions,
  mapSubmissionToTestimonial,
  mapTestimonialSubmission,
  rejectTestimonialSubmission,
} from '../testimonial-submissions'
import { getDashboardSubmissions } from '../client-dashboard'
import { TestimonialError } from '../testimonials-lifecycle'
import type { TestimonialPrivateStore, TestimonialPrivateWrite } from '../testimonials-private'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { TESTIMONIAL_FORM_ID, TESTIMONIAL_FORM_KEYS as K } from '@/lib/modules/testimonials/model'

const PROJECT = 'project-a'
const SUB = '33333333-3333-4333-8333-333333333333'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PROJECT,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['testimonials.read', 'testimonials.write', 'testimonials.private.read', 'testimonials.delete', 'forms.submission.read', 'forms.submission.update'],
  enabledModuleIds: ['testimonials', 'forms'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })
const noPrivate = () => grant({ role: 'editor', permissions: ['testimonials.read', 'testimonials.write'] })

const submissionRow = (o: Record<string, unknown> = {}) => ({
  id: SUB,
  form_id: TESTIMONIAL_FORM_ID,
  status: 'new',
  completion_state: 'complete',
  locale: 'it',
  created_at: '2026-11-07T09:30:00Z',
  gdpr_consent: true,
  gdpr_consent_at: '2026-11-07T09:29:58Z',
  submission_data: {
    [K.displayName]: 'Anna B.',
    [K.fullName]: 'Anna Bianchi',
    [K.email]: 'anna@example.com',
    [K.phone]: '+39 333 1234567',
    [K.text]: 'Un corso bellissimo, grazie.',
    [K.rating]: 5,
  },
  ...o,
})

// ── mapping ──────────────────────────────────────────────────────────────────

describe('mapping a submission', () => {
  it('reads the stable form keys', () => {
    expect(mapTestimonialSubmission(submissionRow())).toEqual({
      id: SUB,
      createdAt: '2026-11-07T09:30:00Z',
      status: 'new',
      locale: 'it',
      displayName: 'Anna B.',
      fullName: 'Anna Bianchi',
      email: 'anna@example.com',
      phone: '+39 333 1234567',
      text: 'Un corso bellissimo, grazie.',
      rating: 5,
      consent: true,
      consentAt: '2026-11-07T09:29:58Z',
    })
  })

  it('splits public from private and sets permission ONLY from the consent box', () => {
    const now = new Date('2026-11-08T10:00:00Z')
    const yes = mapSubmissionToTestimonial(submissionRow(), 'it', now)
    expect(yes.permissionToPublish).toBe(true)
    expect(yes.initial).toEqual({
      displayName: 'Anna B.',
      body: { it: 'Un corso bellissimo, grazie.' },
      originalLocale: 'it',
      rating: 5,
      givenOn: '2026-11-07',
      source: 'website',
      permissionToPublish: true,
    })
    expect(yes.private).toEqual({ fullName: 'Anna Bianchi', email: 'anna@example.com', phone: '+39 333 1234567', submissionId: SUB, permissionGivenAt: '2026-11-07T09:29:58Z' })
    // Nothing private leaks into the public half.
    expect(JSON.stringify(yes.initial)).not.toMatch(/Bianchi|anna@|333/)

    const no = mapSubmissionToTestimonial(submissionRow({ gdpr_consent: false, gdpr_consent_at: null }), 'it', now)
    expect(no.permissionToPublish).toBe(false)
    expect(no.initial.permissionToPublish).toBe(false)
    expect(no.private.permissionGivenAt).toBeNull()
  })

  it('consent without a date is dated now; a missing display name falls back to the full name; an unknown language to the site default', () => {
    const now = new Date('2026-11-08T10:00:00Z')
    const m = mapSubmissionToTestimonial(submissionRow({ gdpr_consent_at: null, locale: 'klingon', submission_data: { [K.fullName]: 'Anna Bianchi', [K.text]: 'Ciao', [K.rating]: '4' } }), 'de', now)
    expect(m.private.permissionGivenAt).toBe('2026-11-08T10:00:00.000Z')
    expect(m.initial).toMatchObject({ displayName: 'Anna Bianchi', body: { de: 'Ciao' }, originalLocale: 'de', rating: 4 })
  })

  it('ignores an out-of-range rating', () => {
    expect(mapSubmissionToTestimonial(submissionRow({ submission_data: { [K.text]: 'x', [K.rating]: 9 } }), 'it', new Date()).initial.rating).toBeUndefined()
  })
})

// ── fakes ────────────────────────────────────────────────────────────────────

function fakeSubmissions(rows: Array<Record<string, unknown>>, opts: { updateError?: boolean } = {}) {
  const log: Array<{ op: string; args: unknown[] }> = []
  const db = {
    from: (table: string) => {
      const chain: Array<[string, unknown[]]> = []
      let mode = 'select'
      let patch: Record<string, unknown> = {}
      const filters: Record<string, unknown> = {}
      const q: Record<string, unknown> = {}
      q.select = (...a: unknown[]) => (chain.push(['select', a]), q)
      q.update = (v: Record<string, unknown>) => ((mode = 'update'), (patch = v), chain.push(['update', [v]]), q)
      q.eq = (k: string, v: unknown) => ((filters[k] = v), chain.push(['eq', [k, v]]), q)
      q.neq = (k: string, v: unknown) => (chain.push(['neq', [k, v]]), q)
      q.order = () => q
      q.limit = () => q
      const result = () => {
        log.push({ op: `${mode}:${table}`, args: chain as never })
        if (mode === 'update') return { data: null, error: opts.updateError ? { message: 'no' } : null }
        const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => k === 'project_id' || r[k] === v))
        return { data: matched, error: null }
      }
      q.maybeSingle = async () => ({ data: (result().data as unknown[] | null)?.[0] ?? null, error: null })
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok)
      void patch
      return q
    },
  }
  return { db: db as never, log }
}

function fakeStore(opts: { available?: boolean; links?: Array<[string, string]> } = {}) {
  const saved: Array<{ publicId: string; input: TestimonialPrivateWrite; expected: number | null }> = []
  const store: TestimonialPrivateStore = {
    read: vi.fn(async () => ({ available: true as const, row: null })),
    readMany: vi.fn(async () => ({ available: true as const, rows: new Map() })),
    bySubmissions: vi.fn(async () => (opts.available === false ? { available: false as const } : { available: true as const, links: new Map(opts.links ?? []) })),
    save: vi.fn(async (_p, publicId, input, expected) => {
      saved.push({ publicId, input, expected })
      return { fullName: null, email: null, phone: null, note: null, submissionId: null, permissionGivenAt: null, version: 1, updatedAt: null }
    }),
    remove: vi.fn(async () => true),
  }
  return { store, saved }
}

function fakeSanity(found: Array<{ _id: string; publicId: string }> = []) {
  const created: Array<Record<string, unknown>> = []
  const client = {
    getDocument: vi.fn(),
    fetch: vi.fn(async (q: string) => {
      if (q.includes('count(*[_type == "project"')) return 1
      if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
      if (q.includes('count(*[_type == "testimonial"')) return 0
      if (q.includes('publicId in $publicIds')) return found
      throw new Error(`unexpected ${q}`)
    }),
    create: vi.fn(async (d: Record<string, unknown>) => (created.push(d), { ...d, _rev: 'c1' })),
    patch: vi.fn(),
    transaction: vi.fn(() => ({ delete: vi.fn().mockReturnThis(), commit: vi.fn(async () => ({})) })),
  }
  return { client, created }
}

const deps = (s: ReturnType<typeof fakeSubmissions>, st: ReturnType<typeof fakeStore>, sn: ReturnType<typeof fakeSanity>) => {
  let n = 0
  return {
    submissions: s.db,
    privateStore: st.store,
    client: sn.client as never,
    uuid: () => (++n === 1 ? 'tm-new' : '22222222-2222-4222-8222-222222222222'),
    now: () => new Date('2026-11-08T10:00:00Z'),
    audit: vi.fn(async () => undefined),
  }
}

// ── create from submission ───────────────────────────────────────────────────

describe('createTestimonialFromSubmission', () => {
  it('creates a DRAFT with permission from consent, writes the private row and marks the submission processed', async () => {
    const s = fakeSubmissions([submissionRow()])
    const st = fakeStore()
    const sn = fakeSanity()
    const r = await createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(s, st, sn))
    expect(r).toEqual({ id: 'tm-new', publicId: '22222222-2222-4222-8222-222222222222', rev: 'c1', permissionToPublish: true, submissionMarked: true })
    expect(sn.created[0]).toMatchObject({
      _id: 'drafts.tm-new',
      _type: 'testimonial',
      projectSlug: 'hoffmann',
      displayName: 'Anna B.',
      permissionToPublish: true,
      source: 'website',
      originalLocale: 'it',
      rating: 5,
      givenOn: '2026-11-07',
      body: { _type: 'localizedText', it: 'Un corso bellissimo, grazie.' },
    })
    expect(JSON.stringify(sn.created[0])).not.toMatch(/Bianchi|anna@example|333/)
    expect(st.saved).toEqual([
      { publicId: '22222222-2222-4222-8222-222222222222', expected: null, input: { fullName: 'Anna Bianchi', email: 'anna@example.com', phone: '+39 333 1234567', submissionId: SUB, permissionGivenAt: '2026-11-07T09:29:58Z' } },
    ])
    const upd = s.log.find((l) => l.op === 'update:form_submissions')!
    expect(upd.args).toContainEqual(['update', [{ status: 'processed' }]])
    expect(upd.args).toContainEqual(['eq', ['project_id', PROJECT]])
    expect(upd.args).toContainEqual(['eq', ['id', SUB]])
  })

  it('without the consent box permission stays OFF', async () => {
    const s = fakeSubmissions([submissionRow({ gdpr_consent: false, gdpr_consent_at: null })])
    const sn = fakeSanity()
    const r = await createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(s, fakeStore(), sn))
    expect(r.permissionToPublish).toBe(false)
    expect(sn.created[0].permissionToPublish).toBe(false)
  })

  it('a failed status update does not undo the draft', async () => {
    const s = fakeSubmissions([submissionRow()], { updateError: true })
    const r = await createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(s, fakeStore(), fakeSanity()))
    expect(r.submissionMarked).toBe(false)
  })

  it('refuses a submission of another form, another id, junk, or a second time', async () => {
    const other = fakeSubmissions([submissionRow({ form_id: 'contact' })])
    const st = fakeStore()
    const sn = fakeSanity()
    await expect(createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(other, st, sn))).rejects.toMatchObject({ code: 'submission_not_found' })
    await expect(createTestimonialFromSubmission(ctx(grant()), PROJECT, '44444444-4444-4444-8444-444444444444', deps(fakeSubmissions([submissionRow()]), st, sn))).rejects.toMatchObject({ code: 'submission_not_found' })
    await expect(createTestimonialFromSubmission(ctx(grant()), PROJECT, 'junk', deps(fakeSubmissions([submissionRow()]), st, sn))).rejects.toMatchObject({ code: 'submission_not_found' })
    await expect(createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(fakeSubmissions([submissionRow()]), fakeStore({ links: [[SUB, 'x']] }), sn))).rejects.toMatchObject({ code: 'conflict' })
    expect(sn.created).toEqual([])
  })

  it('creates nothing while the private table is missing', async () => {
    const sn = fakeSanity()
    await expect(createTestimonialFromSubmission(ctx(grant()), PROJECT, SUB, deps(fakeSubmissions([submissionRow()]), fakeStore({ available: false }), sn))).rejects.toMatchObject({ code: 'private_unavailable' })
    expect(sn.created).toEqual([])
  })

  it('needs testimonials.write AND testimonials.private.read, before any read', async () => {
    const s = fakeSubmissions([submissionRow()])
    const st = fakeStore()
    await expect(createTestimonialFromSubmission(ctx(noPrivate()), PROJECT, SUB, deps(s, st, fakeSanity()))).rejects.toThrow(TenantAuthorizationError)
    await expect(createTestimonialFromSubmission(ctx(grant({ role: 'viewer', permissions: ['testimonials.read'] })), PROJECT, SUB, deps(s, st, fakeSanity()))).rejects.toThrow(TenantAuthorizationError)
    await expect(createTestimonialFromSubmission(ctx(grant({ enabledModuleIds: ['forms'] })), PROJECT, SUB, deps(s, st, fakeSanity()))).rejects.toThrow(TenantAuthorizationError)
    expect(s.log).toEqual([])
  })
})

describe('rejectTestimonialSubmission', () => {
  it('marks it archived (the existing status) and only for testimonial submissions', async () => {
    const s = fakeSubmissions([submissionRow()])
    await rejectTestimonialSubmission(ctx(grant()), PROJECT, SUB, { submissions: s.db })
    expect(s.log.find((l) => l.op === 'update:form_submissions')!.args).toContainEqual(['update', [{ status: 'archived' }]])
    await expect(rejectTestimonialSubmission(ctx(grant()), PROJECT, SUB, { submissions: fakeSubmissions([submissionRow({ form_id: 'contact' })]).db })).rejects.toMatchObject({ code: 'submission_not_found' })
    await expect(rejectTestimonialSubmission(ctx(noPrivate()), PROJECT, SUB, { submissions: s.db })).rejects.toThrow(TenantAuthorizationError)
  })
})

// ── inbox ────────────────────────────────────────────────────────────────────

describe('listTestimonialSubmissions', () => {
  it('lists only testimonial submissions of this project, with the testimonial created from each', async () => {
    const s = fakeSubmissions([submissionRow(), submissionRow({ id: '55555555-5555-4555-8555-555555555555', form_id: 'contact' })])
    const sn = fakeSanity([{ _id: 'drafts.tm-9', publicId: 'pub-9' }])
    const list = await listTestimonialSubmissions(ctx(grant()), PROJECT, {}, { submissions: s.db, privateStore: fakeStore({ links: [[SUB, 'pub-9']] }).store, client: sn.client as never })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: SUB, fullName: 'Anna Bianchi', consent: true, testimonial: { id: 'tm-9', publicId: 'pub-9' } })
    const q = s.log[0].args as Array<[string, unknown[]]>
    expect(q).toContainEqual(['eq', ['project_id', PROJECT]])
    expect(q).toContainEqual(['eq', ['form_id', TESTIMONIAL_FORM_ID]])
    expect(q).toContainEqual(['neq', ['status', 'spam']])
  })

  it('works (without links) while the private table is missing, and is refused without private.read', async () => {
    const s = fakeSubmissions([submissionRow()])
    const list = await listTestimonialSubmissions(ctx(grant()), PROJECT, {}, { submissions: s.db, privateStore: fakeStore({ available: false }).store, client: fakeSanity().client as never })
    expect(list[0].testimonial).toBeNull()
    await expect(listTestimonialSubmissions(ctx(noPrivate()), PROJECT, {}, { submissions: s.db })).rejects.toThrow(TenantAuthorizationError)
  })
})

// ── excluded from Contact requests ───────────────────────────────────────────

describe('Contact requests do not include testimonial submissions', () => {
  it('getDashboardSubmissions filters the testimonial form out', async () => {
    const chain: Array<[string, unknown[]]> = []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order']) q[m] = (...a: unknown[]) => (chain.push([m, a]), q)
    q.limit = async (...a: unknown[]) => (chain.push(['limit', a]), { data: [], error: null })
    await getDashboardSubmissions(ctx(grant()), PROJECT, {}, { client: { from: () => q } as never })
    expect(chain).toContainEqual(['neq', ['form_id', TESTIMONIAL_FORM_ID]])
    expect(chain).toContainEqual(['neq', ['status', 'spam']])
  })
})

describe('errors', () => {
  it('are TestimonialErrors with opaque codes', () => {
    const e = new TestimonialError('permission_required', 'm', { field: 'permissionToPublish' })
    expect(e.code).toBe('permission_required')
    expect(e.detail).toEqual({ field: 'permissionToPublish' })
    expect(e.name).toBe('TestimonialError')
  })
})
