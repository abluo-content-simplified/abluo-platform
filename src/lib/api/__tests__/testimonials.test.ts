/**
 * Testimonials in the client dashboard (ADR-048). Every refusal happens BEFORE
 * any write; identity comes from the grant; PUBLISH needs permission to publish;
 * permanent delete is owner-only and removes the private row too.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  archiveTestimonial,
  backOnlineTestimonial,
  createTestimonial,
  deleteTestimonialDraft,
  deleteTestimonialPermanently,
  discardTestimonialDraft,
  getTestimonial,
  getTestimonialActivity,
  getTestimonialPrivate,
  listTestimonials,
  openTestimonialForEdit,
  publishTestimonialDraft,
  readTestimonialNames,
  restoreTestimonial,
  runTestimonialLifecycle,
  saveTestimonialDraft,
  saveTestimonialPrivate,
  unpublishTestimonial,
  TestimonialError,
} from '../testimonials'
import type { TestimonialPrivateRow, TestimonialPrivateStore, TestimonialPrivateWrite } from '../testimonials-private'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const T = 'testimonial-1'
const PUBLIC_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT = 'project-a'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PROJECT,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['testimonials.read', 'testimonials.write', 'testimonials.private.read', 'testimonials.delete'],
  enabledModuleIds: ['testimonials'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['testimonials.read', 'testimonials.write', 'testimonials.private.read'] })
const writerNoPrivate = () => grant({ role: 'editor', permissions: ['testimonials.read', 'testimonials.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['testimonials.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const body = (o: Record<string, unknown>) => ({ _type: 'localizedText', ...o })
const baseDocs = (): Docs => ({
  [T]: {
    _id: T,
    _type: 'testimonial',
    _rev: 'p1',
    _createdAt: '2026-10-01T00:00:00Z',
    projectSlug: 'hoffmann',
    publicId: PUBLIC_ID,
    displayName: 'Anna',
    permissionToPublish: true,
    body: body({ it: 'Bellissimo' }),
  },
  [`drafts.${T}`]: {
    _id: `drafts.${T}`,
    _type: 'testimonial',
    _rev: 'd1',
    _createdAt: '2026-10-02T00:00:00Z',
    projectSlug: 'hoffmann',
    publicId: PUBLIC_ID,
    displayName: 'Anna B.',
    permissionToPublish: true,
    expiresAt: '2020-01-01T00:00:00Z',
    body: body({ it: 'Bellissimo davvero', translationStatus: { it: { _type: 'translationMeta', status: 'machine', textHash: 'abc' } } }),
  },
  other: { _id: 'other', _type: 'testimonial', _rev: 'o1', projectSlug: 'livener' },
  notone: { _id: 'notone', _type: 'post', _rev: 'x1', projectSlug: 'hoffmann' },
})
const archivedDocs = (): Docs => {
  const d = baseDocs()
  d[T] = { ...d[T], archivedAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z' }
  delete d[`drafts.${T}`]
  return d
}

/** In-memory private store with the real contract (version, conflict, missing table). */
function fakeStore(opts: { available?: boolean; rows?: Record<string, TestimonialPrivateRow>; failRemove?: number } = {}) {
  const rows = new Map(Object.entries(opts.rows ?? {}))
  let removeFailures = opts.failRemove ?? 0
  const calls: Array<[string, unknown[]]> = []
  const store: TestimonialPrivateStore = {
    read: vi.fn(async (p, id) => (calls.push(['read', [p, id]]), opts.available === false ? { available: false as const } : { available: true as const, row: rows.get(id) ?? null })),
    readMany: vi.fn(async (_p: string, ids: readonly string[]) => (opts.available === false ? { available: false as const } : { available: true as const, rows: new Map<string, TestimonialPrivateRow>(ids.filter((i) => rows.has(i)).map((i) => [i, rows.get(i)!] as [string, TestimonialPrivateRow])) })),
    bySubmissions: vi.fn(async () => (opts.available === false ? { available: false as const } : { available: true as const, links: new Map() })),
    save: vi.fn(async (p, id, input: TestimonialPrivateWrite, expected) => {
      calls.push(['save', [p, id, input, expected]])
      if (opts.available === false) throw new TestimonialError('private_unavailable', 'x')
      const cur = rows.get(id)
      if (expected === null && cur) throw new TestimonialError('conflict', 'x')
      if (expected !== null && cur?.version !== expected) throw new TestimonialError('conflict', 'x')
      const next: TestimonialPrivateRow = { fullName: null, email: null, phone: null, note: null, submissionId: null, permissionGivenAt: null, updatedAt: null, ...cur, ...(input as object), version: (cur?.version ?? 0) + 1 } as TestimonialPrivateRow
      rows.set(id, next)
      return next
    }),
    remove: vi.fn(async (p, id) => {
      calls.push(['remove', [p, id]])
      if (removeFailures > 0) {
        removeFailures--
        throw new TestimonialError('failed', 'x')
      }
      rows.delete(id)
      return opts.available !== false
    }),
  }
  return { store, rows, calls }
}

function fake(opts: { docs?: Docs; terms?: string[]; count?: number; commitError?: unknown; store?: ReturnType<typeof fakeStore> } = {}) {
  const docs = opts.docs ?? baseDocs()
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
  const created: Array<Record<string, unknown>> = []
  const writes: string[] = []
  const patch = vi.fn((id: string) => {
    const p = {
      ifRevisionId: (r: string) => (patchOps.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), p),
      set: (v: unknown) => (patchOps.push(['set', v]), p),
      unset: (v: unknown) => (patchOps.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(`patch:${id}`)
        return { _rev: 'd2' }
      }),
    }
    return p
  })
  const transaction = vi.fn(() => {
    const tx = {
      patch: (id: string, v: unknown) => (txOps.push(['patch', [id, v]]), tx),
      create: (d: unknown) => (txOps.push(['create', d]), tx),
      createOrReplace: (d: unknown) => (txOps.push(['createOrReplace', d]), tx),
      delete: (id: string) => (txOps.push(['delete', id]), tx),
      commit: vi.fn(async (o?: { transactionId?: string }) => {
        if (opts.commitError) throw opts.commitError
        writes.push(`tx:${o?.transactionId ?? ''}`)
        return {}
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q.includes('count(*[_type == "testimonial"')) return opts.count ?? 3
    if (q.includes('taxonomyTerm')) return (p.keys as string[]).filter((k) => (opts.terms ?? ['yoga']).includes(k))
    if (q.includes('order(_updatedAt desc)')) {
      return Object.values(docs)
        .filter((d) => d._type === 'testimonial' && d.projectSlug === p.projectSlug)
        .map((d) => ({ ...d, _updatedAt: d._rev === 'd1' ? '2026-10-05T00:00:00Z' : '2026-10-03T00:00:00Z' }))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (created.push(d), writes.push(`create:${d._id}`), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  const audit = vi.fn(async () => undefined)
  const priv = opts.store ?? fakeStore()
  let n = 0
  return {
    client,
    writes,
    patchOps,
    txOps,
    created,
    audit,
    priv,
    deps: {
      client: client as never,
      uuid: () => (++n === 1 ? 'new-testimonial-1' : '22222222-2222-4222-8222-222222222222'),
      now: () => new Date('2026-11-08T10:00:00Z'),
      audit,
      privateStore: priv.store,
    },
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const calls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>) => [
    () => createTestimonial(c, PROJECT, {}, f.deps),
    () => openTestimonialForEdit(c, PROJECT, { id: T }, f.deps),
    () => saveTestimonialDraft(c, PROJECT, { id: T, rev: 'd1', set: { featured: true } }, f.deps),
    () => publishTestimonialDraft(c, PROJECT, { id: T, rev: 'd1' }, f.deps),
    () => discardTestimonialDraft(c, PROJECT, { id: T, rev: 'd1' }, f.deps),
    () => unpublishTestimonial(c, PROJECT, { id: T }, f.deps),
    () => backOnlineTestimonial(c, PROJECT, { id: T }, f.deps),
    () => archiveTestimonial(c, PROJECT, { id: T }, f.deps),
    () => restoreTestimonial(c, PROJECT, { id: T }, f.deps),
    () => deleteTestimonialDraft(c, PROJECT, { id: T }, f.deps),
    () => deleteTestimonialPermanently(c, PROJECT, { id: T }, f.deps),
  ]
  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without the Testimonials module', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of calls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('a viewer can read, an unknown project cannot', async () => {
    const f = fake()
    await expect(listTestimonials(ctx(viewer()), PROJECT, f.deps)).resolves.toBeDefined()
    await expect(getTestimonial(ctx(viewer()), PROJECT, T, f.deps)).resolves.toBeDefined()
    await expect(listTestimonials(ctx(viewer()), 'project-zzz', f.deps)).rejects.toThrow(TenantAuthorizationError)
  })

  it('only the owner may delete permanently — an editor is refused before any read', async () => {
    const f = fake({ docs: archivedDocs() })
    await expect(deleteTestimonialPermanently(ctx(editor()), PROJECT, { id: T }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.priv.store.remove).not.toHaveBeenCalled()
  })

  it('private details need testimonials.private.read', async () => {
    const f = fake()
    await expect(getTestimonialPrivate(ctx(writerNoPrivate()), PROJECT, { id: T }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getTestimonialPrivate(ctx(viewer()), PROJECT, { id: T }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(saveTestimonialPrivate(ctx(writerNoPrivate()), PROJECT, { id: T, version: null, set: { email: 'a@b.it' } }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.priv.store.read).not.toHaveBeenCalled()
    expect(f.priv.store.save).not.toHaveBeenCalled()
  })

  it('a created draft may not carry private details without testimonials.private.read', async () => {
    const f = fake()
    await expect(createTestimonial(ctx(writerNoPrivate()), PROJECT, { private: { fullName: 'A' } }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.writes).toEqual([])
  })
})

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('ids cannot be probed across projects or types', () => {
  it.each(['other', 'notone', 'missing', '../etc', 'drafts.x'])('%s is not_found everywhere', async (id) => {
    const f = fake()
    const c = ctx(grant())
    for (const call of [
      () => getTestimonial(c, PROJECT, id, f.deps),
      () => openTestimonialForEdit(c, PROJECT, { id }, f.deps),
      () => saveTestimonialDraft(c, PROJECT, { id, rev: 'x', set: { featured: true } }, f.deps),
      () => publishTestimonialDraft(c, PROJECT, { id, rev: 'x' }, f.deps),
      () => archiveTestimonial(c, PROJECT, { id }, f.deps),
      () => getTestimonialPrivate(c, PROJECT, { id }, f.deps),
      () => getTestimonialActivity(c, PROJECT, { id }, { ...f.deps, read: vi.fn() as never }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.writes).toEqual([])
  })
})

// ── List / read ───────────────────────────────────────────────────────────────

describe('list and read', () => {
  it('lists this project only, with a derived status and the best excerpt', async () => {
    const f = fake()
    const { testimonials, site } = await listTestimonials(ctx(viewer()), PROJECT, f.deps)
    expect(site).toEqual({ defaultLocale: 'it', languages: ['it', 'de'] })
    expect(testimonials).toHaveLength(1)
    expect(testimonials[0]).toMatchObject({
      id: T,
      publicId: PUBLIC_ID,
      displayName: 'Anna B.',
      excerpt: 'Bellissimo davvero',
      isPublished: true,
      hasDraft: true,
      hasChanges: true,
      status: 'published',
      permissionToPublish: true,
    })
    expect(testimonials[0].searchText).toContain('bellissimo')
  })

  it('shows the draft when there is one and tells the editor its revision', async () => {
    const f = fake()
    const s = await getTestimonial(ctx(viewer()), PROJECT, T, f.deps)
    expect(s).toMatchObject({ rev: 'd1', hasDraft: true, isPublished: true, displayName: 'Anna B.', permissionToPublish: true, live: { rev: 'p1' } })
    expect(s.body).toEqual({ it: 'Bellissimo davvero' })
  })

  it('names the real people only for those who may see them', async () => {
    const f = fake({ store: fakeStore({ rows: { [PUBLIC_ID]: { fullName: 'Anna Bianchi', email: null, phone: null, note: null, submissionId: null, permissionGivenAt: null, version: 1, updatedAt: null } } }) })
    expect((await readTestimonialNames(ctx(grant()), PROJECT, [PUBLIC_ID], f.deps)).get(PUBLIC_ID)).toBe('Anna Bianchi')
    expect((await readTestimonialNames(ctx(viewer()), PROJECT, [PUBLIC_ID], f.deps)).size).toBe(0)
    expect((await readTestimonialNames(ctx(grant()), PROJECT, [PUBLIC_ID], { privateStore: fakeStore({ available: false }).store })).size).toBe(0)
  })
})

// ── Create ────────────────────────────────────────────────────────────────────

describe('createTestimonial', () => {
  it('creates a DRAFT with permission OFF and identity from the grant', async () => {
    const f = fake()
    const r = await createTestimonial(ctx(editor()), PROJECT, { displayName: '  Anna   B. ', body: { it: 'Grazie' }, originalLocale: 'it', rating: 5 }, f.deps)
    expect(r).toEqual({ id: 'new-testimonial-1', publicId: '22222222-2222-4222-8222-222222222222', rev: 'c1' })
    expect(f.created[0]).toMatchObject({
      _id: 'drafts.new-testimonial-1',
      _type: 'testimonial',
      projectSlug: 'hoffmann',
      publicId: '22222222-2222-4222-8222-222222222222',
      permissionToPublish: false,
      displayName: 'Anna B.',
      rating: 5,
      originalLocale: 'it',
      body: { _type: 'localizedText', it: 'Grazie' },
    })
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'testimonial', action: 'created', outcome: 'ok' }))
  })

  it('validates what it is given before any write', async () => {
    const f = fake()
    await expect(createTestimonial(ctx(editor()), PROJECT, { rating: 9 }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(createTestimonial(ctx(editor()), PROJECT, { body: { it: 'x'.repeat(6000) } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(createTestimonial(ctx(editor()), PROJECT, { body: { xx: 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('stores the private half with the draft and dates the permission when it is on', async () => {
    const f = fake()
    await createTestimonial(ctx(editor()), PROJECT, { permissionToPublish: true, private: { fullName: 'Anna Bianchi', email: 'a@b.it', submissionId: 'sub-1' } }, f.deps)
    expect(f.priv.store.save).toHaveBeenCalledWith(
      PROJECT,
      '22222222-2222-4222-8222-222222222222',
      { fullName: 'Anna Bianchi', email: 'a@b.it', submissionId: 'sub-1', permissionGivenAt: '2026-11-08T10:00:00.000Z' },
      null
    )
  })

  it('takes the draft back when the private half cannot be stored', async () => {
    const f = fake({ store: fakeStore({ available: false }) })
    await expect(createTestimonial(ctx(editor()), PROJECT, { private: { fullName: 'A' } }, f.deps)).rejects.toMatchObject({ code: 'private_unavailable' })
    expect(f.txOps).toContainEqual(['delete', 'drafts.new-testimonial-1'])
  })

  it('refuses beyond the cap', async () => {
    const f = fake({ count: 10_000 })
    await expect(createTestimonial(ctx(editor()), PROJECT, {}, f.deps)).rejects.toMatchObject({ code: 'too_large' })
  })
})

// ── Save ──────────────────────────────────────────────────────────────────────

describe('saveTestimonialDraft', () => {
  const save = (set: Record<string, unknown>, f = fake(), rev = 'd1') => saveTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev, set }, f.deps)

  it.each(['_id', '_type', 'projectSlug', 'publicId', 'expiresAt', 'archivedAt', 'publishedAt', 'translationStatus', 'body', 'body.it.x', 'fullName', 'email'])('"%s" cannot be changed here', async (path) => {
    const f = fake()
    await expect(save({ [path]: 'x' }, f)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(f.writes).toEqual([])
  })

  it('applies validated values to the draft with the revision guard', async () => {
    const f = fake()
    expect(await save({ rating: 4, 'body.it': ' Ottimo\r\n\r\n\r\nDavvero ', 'context.de': 'Mitglied', givenOn: '2026-10-01', sourceUrl: 'https://example.com/r', source: 'google', featured: true, tags: ['yoga'] }, f)).toEqual({ rev: 'd2' })
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as Record<string, unknown>
    expect(set).toMatchObject({ rating: 4, 'body.it': 'Ottimo\n\nDavvero', 'context.de': 'Mitglied', givenOn: '2026-10-01', source: 'google', featured: true, tags: ['yoga'] })
    expect(f.patchOps).toContainEqual(['ifRevisionId', 'd1'])
    expect(f.patchOps).toContainEqual(['setIfMissing', { body: { _type: 'localizedText' }, context: { _type: 'localizedString' } }])
  })

  it('clears optional fields on null / empty', async () => {
    const f = fake()
    await save({ rating: null, 'body.it': '', displayName: '' }, f)
    expect(f.patchOps.find((o) => o[0] === 'unset')![1]).toEqual(expect.arrayContaining(['rating', 'body.it', 'displayName']))
  })

  it.each([
    [{ rating: 6 }], [{ rating: 2.5 }], [{ age: 200 }], [{ givenOn: '08/11/2026' }], [{ sourceUrl: 'javascript:alert(1)' }], [{ sourceUrl: 'nope' }],
    [{ source: 'myspace' }], [{ anonymous: 'yes' }], [{ permissionToPublish: 1 }], [{ displayName: 'x'.repeat(500) }], [{ 'body.it': 'x'.repeat(6000) }], [{ 'context.it': 'x'.repeat(300) }], [{ tags: 'yoga' }], [{ originalLocale: 'klingon' }],
  ])('rejects %j', async (set) => {
    const f = fake()
    await expect(save(set as never, f)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('refuses a language that is not on the site, and a tag that is not in the vocabulary', async () => {
    const f = fake()
    await expect(save({ 'body.fr': 'x' }, f)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ tags: ['yoga', 'ghost'] }, f)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('refuses a stale revision, a missing draft and an archived testimonial', async () => {
    await expect(save({ featured: true }, fake(), 'old')).rejects.toMatchObject({ code: 'conflict' })
    await expect(save({ featured: true }, fake(), '')).rejects.toMatchObject({ code: 'conflict' })
    const noDraft = baseDocs()
    delete noDraft[`drafts.${T}`]
    await expect(save({ featured: true }, fake({ docs: noDraft }))).rejects.toMatchObject({ code: 'not_found' })
    const archived = baseDocs()
    archived[T] = { ...archived[T], archivedAt: '2026-10-10T00:00:00Z' }
    await expect(save({ featured: true }, fake({ docs: archived }))).rejects.toMatchObject({ code: 'archived' })
  })

  it('a hand-edited machine translation becomes "reviewed"; an untouched one keeps its status', async () => {
    const f = fake()
    await save({ 'body.it': 'Testo cambiato a mano' }, f)
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as Record<string, any>
    expect(set['body.translationStatus.it']).toMatchObject({ _type: 'translationMeta', status: 'reviewed' })
    const g = fake()
    await save({ 'body.de': 'Neu' }, g)
    expect(Object.keys(g.patchOps.find((o) => o[0] === 'set')![1] as object)).toEqual(['body.de'])
  })

  it('stamps WHEN permission was given, and clears it when withdrawn', async () => {
    const f = fake()
    await save({ permissionToPublish: true }, f)
    expect(f.priv.store.save).toHaveBeenCalledWith(PROJECT, PUBLIC_ID, { permissionGivenAt: '2026-11-08T10:00:00.000Z' }, null)
    const withRow = fakeStore({ rows: { [PUBLIC_ID]: { fullName: null, email: null, phone: null, note: null, submissionId: null, permissionGivenAt: '2026-10-01T00:00:00Z', version: 3, updatedAt: null } } })
    const g = fake({ store: withRow })
    await save({ permissionToPublish: false }, g)
    expect(withRow.store.save).toHaveBeenCalledWith(PROJECT, PUBLIC_ID, { permissionGivenAt: null }, 3)
  })

  it('never blocks the save when the private table is missing', async () => {
    const f = fake({ store: fakeStore({ available: false }) })
    await expect(save({ permissionToPublish: true }, f)).resolves.toEqual({ rev: 'd2' })
  })

  it('maps a revision race (409) to conflict', async () => {
    const f = fake({ commitError: { statusCode: 409 } })
    await expect(save({ featured: true }, f)).rejects.toMatchObject({ code: 'conflict' })
  })
})

// ── Publish: refused without permission ──────────────────────────────────────

describe('publishTestimonialDraft — permission to publish (ADR-048 D1)', () => {
  it('is REFUSED without permissionToPublish, naming the field, and nothing is written', async () => {
    const docs = baseDocs()
    docs[`drafts.${T}`] = { ...docs[`drafts.${T}`], permissionToPublish: false }
    const f = fake({ docs })
    const error = await publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, f.deps).catch((e) => e)
    expect(error).toBeInstanceOf(TestimonialError)
    expect(error.code).toBe('permission_required')
    expect(error.detail).toEqual({ field: 'permissionToPublish' })
    expect(f.writes).toEqual([])
    expect(f.txOps).toEqual([])
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'published', outcome: 'refused' }))
  })

  it('is refused when the field is missing altogether (a Studio-made draft)', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${T}`].permissionToPublish
    const f = fake({ docs })
    await expect(publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, f.deps)).rejects.toMatchObject({ code: 'permission_required' })
  })

  it('needs some text, a fresh revision and a restored testimonial', async () => {
    const empty = baseDocs()
    empty[`drafts.${T}`] = { ...empty[`drafts.${T}`], body: body({}) }
    await expect(publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, fake({ docs: empty }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'old' }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    const archived = baseDocs()
    archived[T] = { ...archived[T], archivedAt: '2026-10-10T00:00:00Z' }
    await expect(publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, fake({ docs: archived }).deps)).rejects.toMatchObject({ code: 'archived' })
  })

  it('publishes in one guarded transaction and never carries window fields from the draft', async () => {
    const f = fake()
    const r = await publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, f.deps)
    expect(r.rev).toMatch(/^abluo-dash-/)
    const replaced = f.txOps.find((o) => o[0] === 'createOrReplace')![1] as Record<string, unknown>
    expect(replaced).toMatchObject({ _id: T, _type: 'testimonial', projectSlug: 'hoffmann', permissionToPublish: true, publicId: PUBLIC_ID })
    expect(replaced).not.toHaveProperty('expiresAt')
    expect(f.txOps).toContainEqual(['patch', ['drafts.testimonial-1', { ifRevisionID: 'd1', unset: ['_publishGuard'] }]])
    expect(f.txOps).toContainEqual(['delete', 'drafts.testimonial-1'])
  })

  it('first publication creates the document', async () => {
    const docs = baseDocs()
    delete docs[T]
    const f = fake({ docs })
    await publishTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, f.deps)
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'published', outcome: 'ok' }))
    expect(f.txOps.map((o) => o[0])).toContain('create')
    expect(f.txOps.map((o) => o[0])).not.toContain('createOrReplace')
  })
})

// ── Open / discard ────────────────────────────────────────────────────────────

describe('open for edit / discard', () => {
  it('copies the published version without lifecycle fields; adopts an existing draft', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${T}`]
    docs[T] = { ...docs[T], expiresAt: '2030-01-01T00:00:00Z' }
    const f = fake({ docs })
    expect(await openTestimonialForEdit(ctx(editor()), PROJECT, { id: T }, f.deps)).toEqual({ id: T, rev: 'c1', created: true })
    expect(f.created[0]).toMatchObject({ _id: `drafts.${T}`, displayName: 'Anna' })
    expect(f.created[0]).not.toHaveProperty('expiresAt')
    expect(f.created[0]).not.toHaveProperty('publishedAt')
    expect(await openTestimonialForEdit(ctx(editor()), PROJECT, { id: T }, fake().deps)).toEqual({ id: T, rev: 'd1', created: false })
  })

  it('an archived testimonial must be restored first', async () => {
    await expect(openTestimonialForEdit(ctx(editor()), PROJECT, { id: T }, fake({ docs: archivedDocs() }).deps)).rejects.toMatchObject({ code: 'archived' })
  })

  it('discard needs a published version and a fresh revision', async () => {
    const f = fake()
    await discardTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, f.deps)
    expect(f.txOps).toContainEqual(['delete', `drafts.${T}`])
    const draftOnly = baseDocs()
    delete draftOnly[T]
    await expect(discardTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'd1' }, fake({ docs: draftOnly }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(discardTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev: 'old' }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('unpublish / back online / archive / restore', () => {
  it('unpublish sets expiresAt = now on the published version', async () => {
    const f = fake()
    await unpublishTestimonial(ctx(editor()), PROJECT, { id: T }, f.deps)
    expect(f.patchOps).toContainEqual(['set', { expiresAt: '2026-11-08T10:00:00.000Z' }])
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'unpublished' }))
  })

  it('back online is refused when the published version has no permission to publish', async () => {
    const docs = baseDocs()
    docs[T] = { ...docs[T], permissionToPublish: false, expiresAt: '2026-10-10T00:00:00Z' }
    const f = fake({ docs })
    const error = await backOnlineTestimonial(ctx(editor()), PROJECT, { id: T }, f.deps).catch((e) => e)
    expect(error).toMatchObject({ code: 'permission_required', detail: { field: 'permissionToPublish' } })
    expect(f.writes).toEqual([])
  })

  it('back online removes the unpublish date when permission is on', async () => {
    const docs = baseDocs()
    docs[T] = { ...docs[T], expiresAt: '2026-10-10T00:00:00Z' }
    const f = fake({ docs })
    await backOnlineTestimonial(ctx(editor()), PROJECT, { id: T }, f.deps)
    expect(f.patchOps).toContainEqual(['unset', ['expiresAt']])
  })

  it('archive marks archivedAt/archivedBy (no blocker: testimonials are shown by value); restore keeps it offline', async () => {
    const f = fake()
    await archiveTestimonial(ctx(editor()), PROJECT, { id: T }, f.deps)
    const patches = f.txOps.filter((o) => o[0] === 'patch').map((o) => (o[1] as [string, any])[1])
    expect(patches[0].set).toMatchObject({ archivedAt: '2026-11-08T10:00:00.000Z', archivedBy: 'u1' })
    const g = fake({ docs: archivedDocs() })
    await restoreTestimonial(ctx(editor()), PROJECT, { id: T }, g.deps)
    const unset = g.txOps.filter((o) => o[0] === 'patch').map((o) => (o[1] as [string, any])[1].unset)
    expect(unset[0]).toEqual(expect.arrayContaining(['archivedAt', 'archivedBy']))
  })

  it('an unknown action is refused', async () => {
    await expect(runTestimonialLifecycle(ctx(editor()), PROJECT, { id: T, op: 'explode' as never }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

describe('deleting', () => {
  const stored = (): TestimonialPrivateRow => ({ fullName: 'Anna Bianchi', email: 'a@b.it', phone: null, note: null, submissionId: null, permissionGivenAt: null, version: 1, updatedAt: null })

  it('permanent delete: archived only; removes the document, its draft AND the private row', async () => {
    const live = fake()
    await expect(deleteTestimonialPermanently(ctx(grant()), PROJECT, { id: T }, live.deps)).rejects.toMatchObject({ code: 'archive_first' })
    expect(live.priv.store.remove).not.toHaveBeenCalled()

    const store = fakeStore({ rows: { [PUBLIC_ID]: stored() } })
    const f = fake({ docs: archivedDocs(), store })
    await deleteTestimonialPermanently(ctx(grant()), PROJECT, { id: T }, f.deps)
    expect(f.txOps).toContainEqual(['delete', T])
    expect(store.store.remove).toHaveBeenCalledWith(PROJECT, PUBLIC_ID)
    expect(store.rows.has(PUBLIC_ID)).toBe(false)
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', outcome: 'ok' }))
  })

  it('a failed Sanity delete leaves the private row alone', async () => {
    const store = fakeStore({ rows: { [PUBLIC_ID]: stored() } })
    const f = fake({ docs: archivedDocs(), store, commitError: { statusCode: 500 } })
    await expect(deleteTestimonialPermanently(ctx(grant()), PROJECT, { id: T }, f.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(store.store.remove).not.toHaveBeenCalled()
    expect(store.rows.has(PUBLIC_ID)).toBe(true)
  })

  it('retries removing the private row once, then says so', async () => {
    const once = fakeStore({ rows: { [PUBLIC_ID]: stored() }, failRemove: 1 })
    await deleteTestimonialPermanently(ctx(grant()), PROJECT, { id: T }, fake({ docs: archivedDocs(), store: once }).deps)
    expect(once.store.remove).toHaveBeenCalledTimes(2)
    const never = fakeStore({ rows: { [PUBLIC_ID]: stored() }, failRemove: 5 })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(deleteTestimonialPermanently(ctx(grant()), PROJECT, { id: T }, fake({ docs: archivedDocs(), store: never }).deps)).rejects.toMatchObject({ code: 'failed' })
  })

  it('a never-published draft is deleted by a writer, and its private row goes too', async () => {
    const docs = baseDocs()
    delete docs[T]
    const store = fakeStore({ rows: { [PUBLIC_ID]: stored() } })
    const f = fake({ docs, store })
    await deleteTestimonialDraft(ctx(editor()), PROJECT, { id: T }, f.deps)
    expect(f.txOps).toContainEqual(['delete', `drafts.${T}`])
    expect(store.rows.has(PUBLIC_ID)).toBe(false)
  })

  it('a draft over a published testimonial is not a delete', async () => {
    await expect(deleteTestimonialDraft(ctx(editor()), PROJECT, { id: T }, fake().deps)).rejects.toMatchObject({ code: 'archive_first' })
  })
})

// ── Private details ───────────────────────────────────────────────────────────

describe('private details', () => {
  it('reads through the store; unavailable passes through', async () => {
    const f = fake()
    expect(await getTestimonialPrivate(ctx(editor()), PROJECT, { id: T }, f.deps)).toEqual({ available: true, row: null })
    expect(f.priv.store.read).toHaveBeenCalledWith(PROJECT, PUBLIC_ID)
    expect(await getTestimonialPrivate(ctx(editor()), PROJECT, { id: T }, fake({ store: fakeStore({ available: false }) }).deps)).toEqual({ available: false })
  })

  it('saves validated, trimmed values with the version it read', async () => {
    const f = fake()
    const row = await saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: { fullName: '  Anna Bianchi ', email: 'a@b.it', phone: '', note: null } }, f.deps)
    expect(f.priv.store.save).toHaveBeenCalledWith(PROJECT, PUBLIC_ID, { fullName: 'Anna Bianchi', email: 'a@b.it', phone: null, note: null }, null)
    expect(row.version).toBe(1)
    await expect(saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: { note: 'again' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect((await saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: 1, set: { note: 'again' } }, f.deps)).version).toBe(2)
  })

  it.each([
    [{ email: 'not-an-email' }], [{ fullName: 'x'.repeat(300) }], [{ note: 'x'.repeat(6000) }], [{ phone: 123 }],
  ])('rejects %j', async (set) => {
    const f = fake()
    await expect(saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: set as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.priv.store.save).not.toHaveBeenCalled()
  })

  it('refuses fields outside the private allow-list (submission id, permission date)', async () => {
    const f = fake()
    await expect(saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: { submissionId: 'x' } as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: { permissionGivenAt: 'x' } as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
  })

  it('answers private_unavailable when migration 067 is not applied', async () => {
    const f = fake({ store: fakeStore({ available: false }) })
    await expect(saveTestimonialPrivate(ctx(editor()), PROJECT, { id: T, version: null, set: { note: 'x' } }, f.deps)).rejects.toMatchObject({ code: 'private_unavailable' })
  })
})

// ── Translation status written by the Translate button (ADR-023 / ADR-048 D6) ──

describe('saveTestimonialDraft — machine translation status', () => {
  const save = (set: Record<string, unknown>, f = fake(), rev = 'd1') => saveTestimonialDraft(ctx(editor()), PROJECT, { id: T, rev, set }, f.deps)
  const hash = (text: string) => {
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  const meta = (text: string) => ({ status: 'machine', provider: 'google', sourceLocale: 'it', translatedAt: '2026-11-08T10:00:00Z', textHash: hash(text), sourceHash: hash('Bellissimo') })

  it('stores the text with status machine beside it', async () => {
    const f = fake()
    await save({ 'body.de': 'Wunderschön', 'translation.body.de': meta('Wunderschön') }, f)
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as Record<string, any>
    expect(set['body.de']).toBe('Wunderschön')
    expect(set['body.translationStatus.de']).toMatchObject({ _type: 'translationMeta', status: 'machine', textHash: hash('Wunderschön') })
    expect(f.patchOps).toContainEqual(['setIfMissing', expect.objectContaining({ 'body.translationStatus': { _type: 'translationStatus' } })])
  })

  it('a status for a language that is not on the site, a field outside the three texts, or a malformed status is refused before any write', async () => {
    const f = fake()
    await expect(save({ 'translation.body.fr': meta('x') }, f)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ 'translation.displayName.de': meta('x') }, f)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ 'body.de': 'x', 'translation.body.de': { status: 'original' } }, f)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('clearing the status (null) or the text removes it', async () => {
    const f = fake()
    await save({ 'translation.body.it': null }, f)
    expect(f.patchOps.find((o) => o[0] === 'unset')![1]).toContain('body.translationStatus.it')
  })

  it('the snapshot carries the stored status per language', async () => {
    const f = fake()
    const s = await getTestimonial(ctx(editor()), PROJECT, T, f.deps)
    expect(s.translations.body.it).toMatchObject({ status: 'machine' })
    expect(s.translations.context).toEqual({})
  })
})
