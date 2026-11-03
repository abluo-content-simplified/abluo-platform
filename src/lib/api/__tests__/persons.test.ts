/**
 * People in the client dashboard (ADR-043). Every refusal happens BEFORE any
 * write; identity comes from the grant; photos, groups and links must belong
 * to this project; anonymise removes identifying data; delete is refused while
 * anything (Sanity or event schedules) still names the person.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  ANONYMISE_UNSET,
  anonymisePerson,
  createPerson,
  getPersonForEdit,
  listPersons,
  movePersonContact,
  openPersonForEdit,
  PERSON_LIST_QUERY,
  PERSON_PICKER_QUERY,
  PersonError,
  publishPersonDraft,
  reorderPersons,
  runPersonLifecycle,
  savePersonDraft,
  savePersonPrivate,
  searchPersons,
} from '../persons'
import { PERSON_DELETE_REFERRERS, PERSON_USAGE_QUERY } from '../persons-lifecycle'
import type { PersonPrivateRow, PersonPrivateStore } from '../persons-private'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const PID = '11111111-1111-4111-8111-111111111111'
const PUB = '22222222-2222-4222-8222-222222222222'
const ALL = ['people.person.read', 'people.person.write', 'people.person.archive', 'people.person.anonymise', 'people.person.delete', 'people.taxonomy.write']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['people'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['people.person.read', 'people.person.write', 'people.taxonomy.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['people.person.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const baseDocs = (): Docs => ({
  anna: {
    _id: 'anna', _type: 'person', _rev: 'p1', projectSlug: 'cyce', publicId: PUB, firstName: 'Anna', lastName: 'Rossi',
    jobTitle: { _type: 'localizedString', it: 'Insegnante' }, groups: ['teachers'], visibility: 'page', sortOrder: 10,
    slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'anna' } },
    photo: { _type: 'reference', _ref: 'media-1' },
    contacts: [{ _key: 'c1', _type: 'personContact', kind: 'email', value: 'anna@example.com', preferred: true }],
  },
  'drafts.anna': {
    _id: 'drafts.anna', _type: 'person', _rev: 'd1', projectSlug: 'cyce', publicId: PUB, firstName: 'Anna', lastName: 'Rossi',
    visibility: 'page', sortOrder: 10, slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'anna-maria' } },
    photo: { _type: 'reference', _ref: 'media-1' },
    contacts: [{ _key: 'c1', _type: 'personContact', kind: 'email', value: 'anna@example.com', preferred: true }],
    shortBio: { _type: 'localizedText', it: 'Ciao', translationStatus: { de: 'machine' } },
  },
  archived: { _id: 'archived', _type: 'person', _rev: 'a1', projectSlug: 'cyce', publicId: '33333333-3333-4333-8333-333333333333', firstName: 'Ex', lastName: 'Teacher', archivedAt: '2026-10-01T00:00:00Z' },
  foreign: { _id: 'foreign', _type: 'person', _rev: 'f1', projectSlug: 'livener', publicId: '44444444-4444-4444-8444-444444444444', firstName: 'Not', lastName: 'Ours' },
  notaperson: { _id: 'notaperson', _type: 'post', _rev: 'x1', projectSlug: 'cyce' },
})

type Opts = {
  docs?: Docs
  usage?: Array<{ _id: string; _type: string; title?: unknown; live?: boolean; refs: string[] }>
  deleteRefs?: Array<{ _id: string; _type: string; label?: unknown }>
  mediaOk?: boolean
  terms?: string[]
  linkTargets?: string[]
  slugTaken?: boolean
  projectCount?: number
  commitError?: unknown
}

function fakePrivate(opts: { available?: boolean; row?: PersonPrivateRow | null; saveError?: unknown; removeError?: unknown } = {}) {
  let row = opts.row ?? null
  const calls: Array<[string, ...unknown[]]> = []
  const store: PersonPrivateStore = {
    read: vi.fn(async (...a) => (calls.push(['read', ...a]), opts.available === false ? { available: false as const } : { available: true as const, row })),
    save: vi.fn(async (_p, _id, input, v) => {
      calls.push(['save', input, v])
      if (opts.saveError) throw opts.saveError
      if (opts.available === false) throw new PersonError('private_unavailable', 'x')
      row = { contacts: [], birthday: null, notes: null, updatedAt: null, ...(row ?? {}), ...input, version: (v ?? 0) + 1 } as PersonPrivateRow
      return row
    }),
    remove: vi.fn(async (...a) => {
      calls.push(['remove', ...a])
      if (opts.removeError) throw opts.removeError
      return opts.available !== false
    }),
  }
  return { store, calls }
}

function fake(opts: Opts = {}, priv = fakePrivate(), sessions: Map<string, number> | null = new Map()) {
  const docs = opts.docs ?? baseDocs()
  const writes: Array<[string, unknown]> = []
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
  const created: Array<Record<string, unknown>> = []
  const patch = vi.fn((id: string) => {
    const p = {
      ifRevisionId: (r: string) => (patchOps.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), p),
      set: (v: unknown) => (patchOps.push(['set', v]), p),
      unset: (v: unknown) => (patchOps.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['patch', id])
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
        writes.push(['transaction', o?.transactionId ?? ''])
        return { transactionId: 'tx-1' }
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return opts.projectCount ?? 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q === PERSON_USAGE_QUERY) return (opts.usage ?? []).filter((u) => u.refs.some((r) => (p.ids as string[]).includes(r)))
    if (q === PERSON_DELETE_REFERRERS) return opts.deleteRefs ?? []
    if (q.includes('"n": count(*[_type == "person"')) return { n: 3, max: 40 }
    if (q.includes('_type == "mediaAsset" && projectSlug == $projectSlug][0]._id')) return opts.mediaOk ? p.id : null
    if (q.includes('_type == "mediaAsset" && projectSlug == $projectSlug][0].image.asset->url')) return 'https://cdn/x.jpg'
    if (q.includes('_type == "taxonomyTerm"')) return (p.keys as string[]).filter((k) => (opts.terms ?? []).includes(k))
    if (q.includes('_id in $ids && _type in $types')) return (p.ids as string[]).filter((id) => (opts.linkTargets ?? []).includes(id))
    if (q.includes('slug[$locale].current == $slug][0]._id')) return opts.slugTaken ? 'someone' : null
    if (q.includes('(_id in $ids || _id in $draftIds)')) {
      return Object.values(docs).filter((d) => d._type === 'person' && d.projectSlug === p.projectSlug && ((p.ids as string[]).includes(String(d._id)) || (p.draftIds as string[]).includes(String(d._id)))).map((d) => d._id)
    }
    if (q === PERSON_LIST_QUERY || q === PERSON_PICKER_QUERY) {
      return Object.values(docs).filter((d) => d._type === 'person' && d.projectSlug === p.projectSlug && !(q === PERSON_PICKER_QUERY && d.anonymisedAt)).map((d) => ({ ...d, photoUrl: d.photo ? 'https://cdn/x.jpg' : null }))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (created.push(d), writes.push(['create', d._id]), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  const audit = vi.fn(async () => undefined)
  const scheduleUsage = vi.fn(async () => sessions)
  let n = 0
  return {
    client, writes, patchOps, txOps, created, audit, priv, scheduleUsage,
    deps: {
      client: client as never,
      uuid: () => 'new-person',
      publicUuid: () => '55555555-5555-4555-8555-555555555555',
      newKey: () => `k${++n}`,
      now: () => new Date('2026-11-03T10:00:00Z'),
      audit,
      privateStore: priv.store,
      scheduleUsage,
    },
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const writeCalls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>, pid = PID) => [
    () => createPerson(c, pid, { firstName: 'A', lastName: 'B' }, f.deps),
    () => openPersonForEdit(c, pid, { id: 'anna' }, f.deps),
    () => savePersonDraft(c, pid, { id: 'anna', rev: 'd1', set: { firstName: 'X' } }, f.deps),
    () => publishPersonDraft(c, pid, { id: 'anna', rev: 'd1' }, f.deps),
    () => savePersonPrivate(c, pid, { id: 'anna', version: null, notes: 'x' }, f.deps),
    () => movePersonContact(c, pid, { id: 'anna', rev: 'd1', key: 'c1', to: 'private', privateVersion: null }, f.deps),
    () => reorderPersons(c, pid, { ids: ['anna'] }, f.deps),
    () => runPersonLifecycle(c, pid, { id: 'anna', op: 'archive' }, f.deps),
    () => anonymisePerson(c, pid, { id: 'anna' }, f.deps),
  ]

  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without the People module', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of writeCalls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
    expect(f.priv.calls).toEqual([])
  })

  it('an editor cannot archive, restore, anonymise or delete', async () => {
    const f = fake()
    const c = ctx(editor())
    for (const op of ['archive', 'restore', 'deleteDraft', 'deletePermanently'] as const) {
      await expect(runPersonLifecycle(c, PID, { id: 'anna', op }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    }
    await expect(anonymisePerson(c, PID, { id: 'anna' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it("another tenant's project is refused for reads and writes", async () => {
    const f = fake()
    const c = ctx(grant())
    await expect(listPersons(c, 'other-project', f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(searchPersons(c, 'other-project', {}, f.deps)).rejects.toThrow(TenantAuthorizationError)
    for (const call of writeCalls(c, f, 'other-project')) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.writes).toEqual([])
  })
})

// ── Cross-project ─────────────────────────────────────────────────────────────

describe('cross-project — ids cannot be probed', () => {
  it('a person of another website (or another type) is not_found everywhere', async () => {
    const f = fake()
    const c = ctx(grant())
    for (const id of ['foreign', 'notaperson', 'missing', '../x', 'drafts.anna']) {
      await expect(getPersonForEdit(c, PID, id, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(anonymisePerson(c, PID, { id }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(runPersonLifecycle(c, PID, { id, op: 'deletePermanently' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    }
    await expect(reorderPersons(c, PID, { ids: ['anna', 'foreign'] }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })

  it('the list holds only this website’s people', async () => {
    const f = fake()
    const { persons } = await listPersons(ctx(viewer()), PID, f.deps)
    expect(persons.map((p) => p.id).sort()).toEqual(['anna', 'archived'])
  })

  it('a photo, a group or a link of another website is refused', async () => {
    const c = ctx(editor())
    await expect(savePersonDraft(c, PID, { id: 'anna', rev: 'd1', set: { photo: 'media-of-livener' } }, fake({ mediaOk: false }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(savePersonDraft(c, PID, { id: 'anna', rev: 'd1', set: { groups: ['teachers', 'dentists'] } }, fake({ terms: ['teachers'] }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    const bio = [{ _type: 'block', _key: 'b', style: 'normal', markDefs: [{ _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: 'page-elsewhere', _weak: true } }], children: [{ _type: 'span', _key: 's', text: 'x', marks: ['l'] }] }]
    await expect(savePersonDraft(c, PID, { id: 'anna', rev: 'd1', set: { 'bio.it': bio } }, fake({ linkTargets: [] }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

// ── Create / edit / publish ───────────────────────────────────────────────────

describe('create, edit, publish', () => {
  it('create needs only first and last name; identity comes from the grant', async () => {
    const f = fake()
    const r = await createPerson(ctx(editor()), PID, { firstName: '  Florian ', lastName: 'Parra' } as never, f.deps)
    expect(r).toEqual({ id: 'new-person', publicId: '55555555-5555-4555-8555-555555555555', rev: 'c1' })
    expect(f.created[0]).toEqual({ _id: 'drafts.new-person', _type: 'person', projectSlug: 'cyce', publicId: '55555555-5555-4555-8555-555555555555', firstName: 'Florian', lastName: 'Parra', visibility: 'listed', sortOrder: 50 })
    await expect(createPerson(ctx(editor()), PID, { firstName: 'Only', lastName: ' ' }, fake().deps)).rejects.toMatchObject({ code: 'missing_name' })
  })

  it('save: allow-list before any read; identity and bookkeeping fields cannot be set', async () => {
    for (const path of ['publicId', 'projectSlug', '_id', 'anonymisedAt', 'archivedAt', 'sortOrder', 'redirectFrom', 'legacyAnchors', 'notes', 'birthday', 'shortBio', 'bio', 'title.it']) {
      const f = fake()
      await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { [path]: 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
      expect(f.client.getDocument).not.toHaveBeenCalled()
    }
  })

  it('save: rebuilds values server-side, keeps translation status, checks revisions and slugs', async () => {
    const f = fake({ mediaOk: true, terms: ['teachers'] })
    await savePersonDraft(ctx(editor()), PID, {
      id: 'anna',
      rev: 'd1',
      set: {
        'jobTitle.it': '  Insegnante   di yoga ',
        'shortBio.it': '',
        groups: ['teachers'],
        photo: 'media-1',
        contacts: [{ kind: 'phone', value: '+39 333 1234567', label: 'Studio', preferred: true, evil: 'x' }],
        'slug.it': 'Anna Maria!',
        languages: ['IT', 'en'],
        visibility: 'page',
      },
    }, f.deps)
    const set = f.patchOps.find(([k]) => k === 'set')![1] as Record<string, unknown>
    expect(set['jobTitle.it']).toBe('Insegnante di yoga')
    expect(set.contacts).toEqual([{ _key: 'k1', _type: 'personContact', kind: 'phone', value: '+39 333 1234567', label: 'Studio', preferred: true }])
    expect(set['slug.it']).toEqual({ _type: 'slug', current: 'anna-maria' })
    expect(set.languages).toEqual(['it', 'en'])
    expect(set.photo).toEqual({ _type: 'reference', _ref: 'media-1' })
    expect(f.patchOps).toContainEqual(['unset', ['shortBio.it']])
    // setIfMissing never overwrites the stored object (its translationStatus survives).
    expect(f.patchOps).toContainEqual(['setIfMissing', { jobTitle: { _type: 'localizedString' }, shortBio: { _type: 'localizedText' }, slug: { _type: 'localizedSlug' } }])
    expect(f.patchOps).toContainEqual(['ifRevisionId', 'd1'])

    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'old', set: { firstName: 'X' } }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { 'slug.it': 'anna' } }, fake({ slugTaken: true }).deps)).rejects.toMatchObject({ code: 'slug_taken' })
    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { 'jobTitle.fr': 'x' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { contacts: [{ kind: 'email', value: 'not an email' }] } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { website: 'javascript:alert(1)' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('publish: keeps the publicId, records a changed slug as a redirect, needs a slug for an own page', async () => {
    const f = fake()
    await publishPersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1' }, f.deps)
    const doc = f.txOps.find(([k]) => k === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc).toMatchObject({ _id: 'anna', _type: 'person', projectSlug: 'cyce', publicId: PUB })
    expect(doc.redirectFrom).toEqual({ _type: 'redirectFrom', it: ['anna'] })
    expect(f.txOps.map(([k]) => k)).toEqual(['patch', 'patch', 'createOrReplace', 'delete'])

    const docs = baseDocs()
    delete (docs['drafts.anna'] as Record<string, unknown>).slug
    await expect(publishPersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'missing_slug' })
  })

  it('the editor view merges public and private contacts and flags a missing private table', async () => {
    const priv = fakePrivate({ row: { contacts: [{ _key: 'p1', kind: 'phone', value: '+39 1', label: '', preferred: false }], birthday: '1980-02-03', notes: 'note', version: 4, updatedAt: null } })
    const snap = await getPersonForEdit(ctx(viewer()), PID, 'anna', fake({}, priv).deps)
    expect(snap.contacts.map((c) => [c._key, c.visibility])).toEqual([['c1', 'public'], ['p1', 'private']])
    expect(snap.private).toEqual({ available: true, birthday: '1980-02-03', notes: 'note', version: 4 })
    expect(snap.shortBio).toEqual({ it: 'Ciao' })
    const missing = await getPersonForEdit(ctx(viewer()), PID, 'anna', fake({}, fakePrivate({ available: false })).deps)
    expect(missing.private).toEqual({ available: false })
    expect(missing.contacts.map((c) => c._key)).toEqual(['c1'])
  })
})

// ── Private details and contact moves ─────────────────────────────────────────

describe('private details', () => {
  it('save goes to the private store under the person’s publicId (never the input)', async () => {
    const f = fake()
    await savePersonPrivate(ctx(editor()), PID, { id: 'anna', version: null, birthday: '1980-02-03', notes: ' hi ' }, f.deps)
    expect(f.priv.calls[0]).toEqual(['save', { birthday: '1980-02-03', notes: 'hi' }, null])
    expect(f.priv.store.save).toHaveBeenCalledWith(PID, PUB, expect.anything(), null)
  })

  it('making a contact private: added to private first, then removed from the published person and the draft', async () => {
    const f = fake()
    const r = await movePersonContact(ctx(editor()), PID, { id: 'anna', rev: 'd1', key: 'c1', to: 'private', privateVersion: null }, f.deps)
    expect(r.privateVersion).toBe(1)
    expect(f.priv.calls.map(([k]) => k)).toEqual(['read', 'save'])
    expect(f.txOps).toEqual([
      ['patch', ['anna', { ifRevisionID: 'p1', set: { contacts: [] } }]],
      ['patch', ['drafts.anna', { ifRevisionID: 'd1', set: { contacts: [] } }]],
    ])
  })

  it('refused before any write while the private table is missing', async () => {
    const f = fake({}, fakePrivate({ available: false }))
    await expect(movePersonContact(ctx(editor()), PID, { id: 'anna', rev: 'd1', key: 'c1', to: 'private', privateVersion: null }, f.deps)).rejects.toMatchObject({ code: 'private_unavailable' })
    expect(f.writes).toEqual([])
  })

  it('a failed Sanity step undoes the private copy (nothing lost, nothing duplicated)', async () => {
    const f = fake({ commitError: { statusCode: 409 } })
    await expect(movePersonContact(ctx(editor()), PID, { id: 'anna', rev: 'd1', key: 'c1', to: 'private', privateVersion: null }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.priv.calls.map(([k]) => k)).toEqual(['read', 'save', 'save'])
    expect(f.priv.calls[2][1]).toEqual({ contacts: [] })
  })
})

// ── Archive / delete / anonymise ──────────────────────────────────────────────

describe('archive, delete, anonymise', () => {
  it('archive is allowed while the person is still named somewhere (they stay on that content)', async () => {
    const f = fake({ usage: [{ _id: 'post-1', _type: 'post', refs: ['anna'] }] })
    await runPersonLifecycle(ctx(grant()), PID, { id: 'anna', op: 'archive' }, f.deps)
    const patched = f.txOps.filter(([k]) => k === 'patch').map(([, v]) => (v as [string])[0])
    expect(patched).toEqual(['anna', 'drafts.anna'])
  })

  it('delete is refused while any document references the person', async () => {
    const f = fake({ deleteRefs: [{ _id: 'drafts.post-1', _type: 'post', label: { it: 'Articolo' } }] })
    const err = await runPersonLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps).catch((e) => e)
    expect(err).toBeInstanceOf(PersonError)
    expect(err.code).toBe('in_use')
    expect(err.detail.usedIn).toEqual([{ kind: 'post', id: 'post-1', title: 'Articolo', published: false }])
    expect(f.writes).toEqual([])
  })

  it('delete is refused while an event schedule names the person, and when schedules cannot be read', async () => {
    const pub = '33333333-3333-4333-8333-333333333333'
    const f = fake({}, fakePrivate(), new Map([[pub, 2]]))
    const err = await runPersonLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps).catch((e) => e)
    expect(err.code).toBe('in_use')
    expect(err.detail.usedIn[0]).toMatchObject({ kind: 'sessions' })
    expect(f.scheduleUsage).toHaveBeenCalledWith(PID, [pub])
    const g = fake({}, fakePrivate(), null)
    await expect(runPersonLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, g.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(f.writes).toEqual([])
    expect(g.writes).toEqual([])
  })

  it('an unreferenced archived person is deleted, then the private row', async () => {
    const f = fake()
    const r = await runPersonLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps)
    expect(r).toEqual({ rev: null, privateRemoved: true })
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['archived'])
    expect(f.priv.calls).toContainEqual(['remove', PID, '33333333-3333-4333-8333-333333333333'])
  })

  it('a published, not archived person must be archived first', async () => {
    await expect(runPersonLifecycle(ctx(grant()), PID, { id: 'anna', op: 'deletePermanently' }, fake().deps)).rejects.toMatchObject({ code: 'archive_first' })
  })

  it('anonymise: identifying data removed on the published person, draft deleted, private row removed, ids kept', async () => {
    const f = fake()
    const r = await anonymisePerson(ctx(grant()), PID, { id: 'anna' }, f.deps)
    expect(r.privateRemoved).toBe(true)
    const [, [id, change]] = f.txOps[0] as [string, [string, { set: Record<string, unknown>; unset: string[]; ifRevisionID: string }]]
    expect(id).toBe('anna')
    expect(change.ifRevisionID).toBe('p1')
    expect(change.set).toEqual({ firstName: '', lastName: '', visibility: 'off', anonymisedAt: '2026-11-03T10:00:00.000Z' })
    for (const k of ['photo', 'shortBio', 'bio', 'contacts', 'website', 'qualifications', 'displayName', 'honorific', 'jobTitle', 'slug', 'legacyAnchors']) expect(change.unset).toContain(k)
    expect(change.unset).not.toContain('publicId')
    expect([...ANONYMISE_UNSET]).not.toContain('sortOrder')
    expect(f.txOps.map(([k, v]) => (k === 'delete' ? v : k))).toEqual(['patch', 'patch', 'drafts.anna'])
    expect(f.priv.calls).toContainEqual(['remove', PID, PUB])
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'person', action: 'deleted', outcome: 'ok', detail: expect.objectContaining({ anonymised: true }) }))
  })

  it('anonymised people cannot be edited, and a failed private delete is reported for a retry', async () => {
    const docs = baseDocs()
    ;(docs.anna as Record<string, unknown>).anonymisedAt = '2026-11-01T00:00:00Z'
    await expect(savePersonDraft(ctx(editor()), PID, { id: 'anna', rev: 'd1', set: { firstName: 'Back' } }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'anonymised' })
    const f = fake({}, fakePrivate({ removeError: new PersonError('failed', 'x') }))
    expect((await anonymisePerson(ctx(grant()), PID, { id: 'anna' }, f.deps)).privateRemoved).toBe(false)
  })
})

// ── List, picker, reorder ─────────────────────────────────────────────────────

describe('list, picker, reorder', () => {
  it('list: site order, usage counts by kind, sessions, search text', async () => {
    const f = fake({ usage: [{ _id: 'page-1', _type: 'page', refs: ['anna'] }, { _id: 'drafts.post-1', _type: 'post', refs: ['anna'] }] }, fakePrivate(), new Map([[PUB, 3]]))
    const { persons } = await listPersons(ctx(viewer()), PID, f.deps)
    const anna = persons.find((p) => p.id === 'anna')!
    expect(anna).toMatchObject({ publicId: PUB, name: 'Anna Rossi', state: 'changes', visibility: 'page', photoUrl: 'https://cdn/x.jpg', usage: { pages: 1, posts: 1, events: 0, sessions: 3 } })
    expect(anna.searchText).toContain('anna')
    expect(persons.find((p) => p.id === 'archived')!.state).toBe('archived')
  })

  it('picker: excludes archived unless asked, always resolves already-picked ids', async () => {
    const f = fake()
    expect((await searchPersons(ctx(viewer()), PID, { query: 'teacher' }, f.deps)).map((p) => p.id)).toEqual([])
    expect((await searchPersons(ctx(viewer()), PID, { query: 'teacher', includeArchived: true }, f.deps)).map((p) => p.id)).toEqual(['archived'])
    expect((await searchPersons(ctx(viewer()), PID, { query: 'zzz', publicIds: [PUB] }, f.deps)).map((p) => p.id)).toEqual(['anna'])
  })

  it('reorder: sortOrder on both versions, one transaction', async () => {
    const f = fake()
    await reorderPersons(ctx(editor()), PID, { ids: ['archived', 'anna'] }, f.deps)
    expect(f.txOps).toEqual([
      ['patch', ['archived', { set: { sortOrder: 10 } }]],
      ['patch', ['anna', { set: { sortOrder: 20 } }]],
      ['patch', ['drafts.anna', { set: { sortOrder: 20 } }]],
    ])
  })
})
