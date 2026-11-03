/**
 * ADR-043 D5/D9 (agent D) — people placed on posts (authors), events (hosts) and
 * schedules (instructors) must be people OF THE CALLER'S PROJECT, refused before
 * anything is written; the same service rebuilds the stored weak references.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { patchPostDraft, getPostDraft, PostDraftError } from '../post-drafts'
import { patchEventDraft, getEvent, EventError } from '../event-drafts'
import { personRefs, personRefIds } from '../persons-guard'
import { PersonError } from '../persons-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const MINE = 'person-mine-1'
const MINE2 = 'person-mine-2'
const DRAFT_ONLY = 'person-draft-only'
const ARCHIVED = 'person-archived'
const ANON = 'person-anonymised'
const FOREIGN = 'person-of-hoffmann'

/** People by project, as the raw-perspective read returns them (drafts. ids for never-published ones). */
const PEOPLE: Record<string, Array<Record<string, unknown>>> = {
  livener: [
    { _id: MINE },
    { _id: MINE2 },
    { _id: `drafts.${DRAFT_ONLY}` },
    { _id: ARCHIVED, archivedAt: '2026-10-01T00:00:00Z' },
    { _id: ANON, anonymisedAt: '2026-10-01T00:00:00Z' },
  ],
  hoffmann: [{ _id: FOREIGN }],
}
const personRows = (p: Record<string, unknown>) =>
  (PEOPLE[p.projectSlug as string] ?? []).filter((r) => (p.ids as string[]).includes(String(r._id)) || (p.draftIds as string[]).includes(String(r._id)))

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('livener'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write', 'events.event.read', 'events.event.write', 'people.person.read'],
  enabledModuleIds: ['blog', 'events', 'people'],
  ...o,
})
const ctx = (g: ProjectGrant = grant()): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

function patchRecorder(commitRev = 'r2') {
  const ops: Array<[string, unknown]> = []
  const patch: Record<string, unknown> = {
    ifRevisionId: (r: string) => (ops.push(['ifRevisionId', r]), patch),
    setIfMissing: (v: unknown) => (ops.push(['setIfMissing', v]), patch),
    set: (v: unknown) => (ops.push(['set', v]), patch),
    unset: (v: unknown) => (ops.push(['unset', v]), patch),
    commit: vi.fn(async () => (ops.push(['commit', null]), { _rev: commitRev })),
  }
  return { ops, patch }
}

// ── personRefs (the shared check) ─────────────────────────────────────────────

describe('personRefs', () => {
  const client = () => ({ fetch: vi.fn(async (_q: string, p: Record<string, unknown>) => personRows(p)) })

  it('builds ordered weak references with keys, accepting published and draft-only people of the project', async () => {
    const refs = await personRefs('livener', [DRAFT_ONLY, MINE], { max: 10 }, { client: client() })
    expect(refs).toEqual([
      { _type: 'reference', _ref: DRAFT_ONLY, _key: DRAFT_ONLY, _weak: true },
      { _type: 'reference', _ref: MINE, _key: MINE, _weak: true },
    ])
  })

  it('refuses another project\'s person, an unknown id, an archived or anonymised NEW person — one opaque error', async () => {
    for (const id of [FOREIGN, 'person-nobody', ARCHIVED, ANON]) {
      await expect(personRefs('livener', [MINE, id], { max: 10 }, { client: client() })).rejects.toMatchObject({ code: 'invalid_value' })
    }
  })

  it('refuses duplicates, malformed ids, too many and non-lists', async () => {
    const c = client()
    await expect(personRefs('livener', [MINE, MINE], { max: 10 }, { client: c })).rejects.toBeInstanceOf(PersonError)
    await expect(personRefs('livener', ['drafts.x'], { max: 10 }, { client: c })).rejects.toBeInstanceOf(PersonError)
    await expect(personRefs('livener', [MINE, MINE2], { max: 1 }, { client: c })).rejects.toBeInstanceOf(PersonError)
    await expect(personRefs('livener', 'person-mine-1', { max: 10 }, { client: c })).rejects.toBeInstanceOf(PersonError)
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it('keeps a stored person (and its _key) even if archived or gone since; only NEW ids are checked', async () => {
    const c = client()
    const stored = [{ _type: 'reference', _ref: ARCHIVED, _key: 'k-old', _weak: true }]
    const refs = await personRefs('livener', [MINE, ARCHIVED], { max: 10, stored }, { client: c })
    expect(refs.map((r) => [r._ref, r._key])).toEqual([[MINE, MINE], [ARCHIVED, 'k-old']])
    expect((c.fetch.mock.calls[0][1] as { ids: string[] }).ids).toEqual([MINE])
  })

  it('an unreadable Sanity is "failed", not a pass', async () => {
    const broken = { fetch: vi.fn(async () => { throw new Error('down') }) }
    await expect(personRefs('livener', [MINE], { max: 10 }, { client: broken })).rejects.toMatchObject({ code: 'failed' })
  })

  it('personRefIds reads stored refs in order, without drafts. and repeats', () => {
    expect(personRefIds([{ _ref: 'a' }, { _ref: 'drafts.b' }, { _ref: 'a' }, {}, null])).toEqual(['a', 'b'])
    expect(personRefIds(undefined)).toEqual([])
  })
})

// ── Post authors ──────────────────────────────────────────────────────────────

const POST = '11111111-2222-4333-8444-555555555555'
function postClient(stored: Record<string, unknown> = {}) {
  const { ops, patch } = patchRecorder()
  const draft = { _id: `drafts.${POST}`, _type: 'post', _rev: 'r1', projectSlug: 'livener', ...stored }
  const client = {
    create: vi.fn(),
    getDocument: vi.fn(async (id: string) => (id === `drafts.${POST}` ? draft : undefined)),
    patch: vi.fn(() => patch),
    fetch: vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.startsWith('count(')) return 1
      if (q.includes('_type == "person"')) return personRows(p)
      return { locales: ['en'], categories: [], categoryTerms: [] }
    }),
  }
  return { client, ops }
}
const patchPost = (set: Record<string, unknown>, c = ctx(), stored?: Record<string, unknown>) => {
  const f = postClient(stored)
  return { f, run: () => patchPostDraft(c, 'project-a', { id: POST, rev: 'r1', set }, { client: f.client as never }) }
}

describe('post drafts — authors', () => {
  it('stores this project\'s people as ordered weak references (first = main) and unsets on []', async () => {
    const a = patchPost({ authors: [MINE2, MINE] })
    expect(await a.run()).toEqual({ rev: 'r2' })
    const set = a.f.ops.find(([k]) => k === 'set')![1] as { authors: unknown }
    expect(set.authors).toEqual([
      { _type: 'reference', _ref: MINE2, _key: MINE2, _weak: true },
      { _type: 'reference', _ref: MINE, _key: MINE, _weak: true },
    ])
    const b = patchPost({ authors: [] })
    await b.run()
    expect(b.f.ops.find(([k]) => k === 'unset')![1]).toContain('authors')
  })

  it('refuses another project\'s person BEFORE any write', async () => {
    const a = patchPost({ authors: [MINE, FOREIGN] })
    await expect(a.run()).rejects.toMatchObject({ name: 'PostDraftError', code: 'invalid_value' })
    expect(a.f.client.patch).not.toHaveBeenCalled()
  })

  it('refuses more than 10 authors and duplicates', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `person-x-${i}`)
    await expect(patchPost({ authors: many }).run()).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(patchPost({ authors: [MINE, MINE] }).run()).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('needs the People module and people.person.read — nothing is read or written otherwise', async () => {
    const noModule = patchPost({ authors: [MINE] }, ctx(grant({ enabledModuleIds: ['blog'] })))
    await expect(noModule.run()).rejects.toBeInstanceOf(TenantAuthorizationError)
    const noPerm = patchPost({ authors: [MINE] }, ctx(grant({ permissions: ['blog.post.read', 'blog.post.write'] })))
    await expect(noPerm.run()).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(noModule.f.client.getDocument).not.toHaveBeenCalled()
    expect(noPerm.f.client.patch).not.toHaveBeenCalled()
  })

  it('a patch without authors never needs the People module', async () => {
    const a = patchPost({ 'title.en': 'Hello' }, ctx(grant({ enabledModuleIds: ['blog'], permissions: ['blog.post.read', 'blog.post.write'] })))
    await expect(a.run()).resolves.toEqual({ rev: 'r2' })
  })

  it('keeps a stored author that was archived since while reordering', async () => {
    const stored = { authors: [{ _type: 'reference', _ref: ARCHIVED, _key: 'k1', _weak: true }, { _type: 'reference', _ref: MINE, _key: 'k2', _weak: true }] }
    const a = patchPost({ authors: [MINE, ARCHIVED] }, ctx(), stored)
    await a.run()
    expect((a.f.ops.find(([k]) => k === 'set')![1] as { authors: Array<{ _key: string }> }).authors.map((r) => r._key)).toEqual(['k2', 'k1'])
  })

  it('the snapshot lists the author ids in order', async () => {
    const f = postClient({ authors: [{ _ref: MINE2, _key: 'a' }, { _ref: MINE, _key: 'b' }], title: {}, body: {} })
    const snap = await getPostDraft(ctx(), 'project-a', POST, { client: f.client as never })
    expect(snap.authors).toEqual([MINE2, MINE])
  })
})

// ── Event hosts ───────────────────────────────────────────────────────────────

const EV = 'ev-1'
function eventClient(eventsConfig: Record<string, unknown> | null, draftExtra: Record<string, unknown> = {}) {
  const { ops, patch } = patchRecorder('d2')
  const draft = { _id: `drafts.${EV}`, _type: 'event', _rev: 'd1', projectSlug: 'livener', title: { en: 'MIR' }, startDate: '2026-04-12T07:00:00.000Z', ...draftExtra }
  const client = {
    create: vi.fn(),
    getDocument: vi.fn(async (id: string) => (id === `drafts.${EV}` ? draft : undefined)),
    patch: vi.fn(() => patch),
    transaction: vi.fn(),
    fetch: vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes('count(*[_type == "project"')) return 1
      if (q.includes('moduleId == "events"') && !q.includes('"taxonomyTerm"')) return eventsConfig
      if (q.includes('_type == "person"')) return personRows(p)
      if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'en', supportedLocales: ['en'] }
      return null
    }),
  }
  return { client, ops }
}
const patchEvent = (f: ReturnType<typeof eventClient>, set: Record<string, unknown>, c = ctx()) =>
  patchEventDraft(c, 'project-a', { id: EV, rev: 'd1', set }, { client: f.client as never })

describe('event drafts — hosts from People', () => {
  it('stores this project\'s people as weak references when the Hosts capability is on', async () => {
    const f = eventClient({ capHosts: true })
    await expect(patchEvent(f, { hostPeople: [MINE, DRAFT_ONLY] })).resolves.toEqual({ rev: 'd2' })
    const set = f.ops.find(([k]) => k === 'set')![1] as { hostPeople: Array<Record<string, unknown>> }
    expect(set.hostPeople).toEqual([
      { _type: 'reference', _ref: MINE, _key: MINE, _weak: true },
      { _type: 'reference', _ref: DRAFT_ONLY, _key: DRAFT_ONLY, _weak: true },
    ])
  })

  it('refuses another project\'s person before any write', async () => {
    const f = eventClient({ capHosts: true })
    await expect(patchEvent(f, { hostPeople: [FOREIGN] })).rejects.toMatchObject({ name: 'EventError', code: 'invalid_value' })
    expect(f.client.patch).not.toHaveBeenCalled()
  })

  it('respects the Hosts capability (off by default) and the People permission', async () => {
    const off = eventClient(null)
    await expect(patchEvent(off, { hostPeople: [MINE] })).rejects.toMatchObject({ code: 'invalid_field' })
    expect(off.client.patch).not.toHaveBeenCalled()
    const noPerm = eventClient({ capHosts: true })
    await expect(patchEvent(noPerm, { hostPeople: [MINE] }, ctx(grant({ permissions: ['events.event.read', 'events.event.write'] })))).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(noPerm.client.patch).not.toHaveBeenCalled()
  })

  it('[] unsets; legacy inline hosts are never touched by a hosts patch', async () => {
    const f = eventClient({ capHosts: true }, { hosts: [{ name: 'Old Host' }] })
    await patchEvent(f, { hostPeople: [] })
    expect(f.ops.find(([k]) => k === 'unset')![1]).toEqual(['hostPeople'])
    expect(JSON.stringify(f.ops)).not.toContain('"hosts"')
  })

  it('the snapshot lists host ids and the read-only legacy hosts', async () => {
    const f = eventClient({ capHosts: true }, { hostPeople: [{ _ref: MINE, _key: 'k' }], hosts: [{ name: 'Old Host', role: { en: 'Teacher' } }, { name: '  ' }] })
    const snap = await getEvent(ctx(), 'project-a', EV, { client: f.client as never })
    expect(snap.hostPeople).toEqual([MINE])
    expect(snap.legacyHosts).toEqual([{ name: 'Old Host', role: 'Teacher' }])
    // Hosts are visible in the editor (capability on), so they are not "Studio-only" content.
    expect(snap.hasStudioContent).toBe(false)
  })
})

// keep the imports honest
void PostDraftError
void EventError
