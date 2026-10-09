/**
 * Events in the client dashboard. Every refusal happens BEFORE any write;
 * identity comes from the grant; the cover must be this project's asset;
 * publishing keeps every field the dashboard does not edit.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  cleanRegistrationUrl,
  createEvent,
  discardEventDraft,
  eventTiming,
  getEvent,
  listEvents,
  openEventForEdit,
  parseEventDate,
  patchEventDraft,
  publishEventDraft,
  setEventCover,
  sortEvents,
} from '../event-drafts'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const E = 'ev-1'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('livener'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['events.event.read', 'events.event.write', 'events.event.delete'],
  enabledModuleIds: ['events'],
  ...o,
})
const viewer = () => grant({ role: 'viewer', permissions: ['events.event.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const baseDocs = (): Docs => ({
  [E]: {
    _id: E,
    _type: 'event',
    _rev: 'p1',
    projectSlug: 'livener',
    title: { _type: 'localizedString', en: 'MIR Rimini', it: 'MIR Rimini' },
    slug: { _type: 'localizedSlug', en: { _type: 'slug', current: 'mir-rimini' } },
    startDate: '2026-04-12T07:00:00.000Z',
    status: 'past',
    fullDescription: { en: [{ _type: 'block' }] },
    gallery: [{ _key: 'g1' }],
  },
  other: { _id: 'other', _type: 'event', _rev: 'o1', projectSlug: 'hoffmann', title: { it: 'Altro' }, startDate: '2026-01-01T00:00:00.000Z' },
})

function fake(opts: { docs?: Docs; commitError?: unknown; slugRows?: unknown[] } = {}) {
  const docs = opts.docs ?? baseDocs()
  const writes: Array<[string, unknown]> = []
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
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
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['transaction', txOps.length])
        return {}
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.includes('count(*[_type == "event"')) return 4
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'en', supportedLocales: ['en', 'it'] }
    if (q.includes('_type == "mediaAsset" && _id == $assetId')) {
      return p.assetId === 'm1' && p.projectSlug === 'livener'
        ? { ref: 'image-abc-10x10-jpg', url: 'https://cdn.sanity.io/images/x/y/abc.jpg', altText: { en: 'Stand' }, hotspot: { x: 0.4, y: 0.5, width: 0.3, height: 0.3 } }
        : null
    }
    if (q.includes('_type == "mediaAsset"')) return null
    if (q.includes('{ _id, slug }')) return opts.slugRows ?? [{ _id: 'x', slug: { en: { current: 'summer-day' }, it: { current: 'giornata' } } }]
    if (q.includes('_type == "event"')) {
      return Object.values(docs)
        .filter((d) => d._type === 'event' && d.projectSlug === p.projectSlug)
        .map((d) => ({ _id: d._id, _updatedAt: '2026-10-01T00:00:00Z', title: d.title, location: d.location, startDate: d.startDate, endDate: d.endDate, status: d.status }))
    }
    if (q.includes('*[_id == $ref]')) return null
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (writes.push(['create', d]), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  return { client, writes, patchOps, txOps, deps: { client: client as never, uuid: () => 'new-uuid-1', now: () => new Date('2026-10-05T10:00:00Z') } }
}

const withDraft = (extra: Record<string, unknown> = {}): Docs => {
  const d = baseDocs()
  d[`drafts.${E}`] = { ...d[E], _id: `drafts.${E}`, _rev: 'd1', ...extra }
  return d
}

describe('gates — refused before any I/O', () => {
  const writesOf = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>, pid = 'project-a') => [
    () => openEventForEdit(c, pid, E, f.deps),
    () => createEvent(c, pid, { title: 'x', startDate: '2026-11-01T10:00:00.000Z' }, f.deps),
    () => patchEventDraft(c, pid, { id: E, rev: 'd1', set: { 'title.en': 'x' } }, f.deps),
    () => setEventCover(c, pid, { id: E, rev: 'd1', assetId: 'm1' }, f.deps),
    () => publishEventDraft(c, pid, { id: E, rev: 'd1' }, f.deps),
    () => discardEventDraft(c, pid, { id: E, rev: 'd1' }, f.deps),
  ]

  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without Events', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of writesOf(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('a viewer can read', async () => {
    const f = fake()
    await expect(listEvents(ctx(viewer()), 'project-a', f.deps)).resolves.toHaveLength(1)
    await expect(getEvent(ctx(viewer()), 'project-a', E, f.deps)).resolves.toMatchObject({ id: E })
  })

  it("another tenant's project is refused", async () => {
    const f = fake()
    for (const call of writesOf(ctx(grant()), f, 'project-b')) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    await expect(listEvents(ctx(grant()), 'project-b', f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })

  it("another project's event id reads as not_found and is never written", async () => {
    const f = fake()
    await expect(getEvent(ctx(grant()), 'project-a', 'other', f.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(openEventForEdit(ctx(grant()), 'project-a', 'other', f.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })

  it('unsafe ids are not_found before anything is read', async () => {
    const f = fake()
    for (const id of ['drafts.x', '../x', 'a/b', 'new']) {
      await expect(patchEventDraft(ctx(grant()), 'project-a', { id, rev: 'r', set: { 'title.en': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })
})

describe('list and read', () => {
  it('lists only this project, in the default language', async () => {
    const f = fake({ docs: withDraft({ title: { en: 'MIR Rimini (new)' } }) })
    const items = await listEvents(ctx(grant()), 'project-a', f.deps)
    expect(items).toEqual([expect.objectContaining({ id: E, title: 'MIR Rimini (new)', hasDraft: true, isPublished: true, timing: 'past' })])
  })

  it('flags Studio-only content and the public slug', async () => {
    const f = fake()
    const e = await getEvent(ctx(grant()), 'project-a', E, f.deps)
    expect(e.hasStudioContent).toBe(true)
    expect(e.publicSlug).toBe('mir-rimini')
    expect(e.rev).toBe('')
  })

  it('sorts coming-up soonest first, then past most recent first', () => {
    const row = (title: string, timing: 'upcoming' | 'past', startDate: string | null) => ({ title, timing, startDate })
    const sorted = sortEvents([row('p-old', 'past', '2025-01-01'), row('u-late', 'upcoming', '2027-02-01'), row('p-new', 'past', '2026-01-01'), row('u-soon', 'upcoming', '2026-11-01')])
    expect(sorted.map((r) => r.title)).toEqual(['u-soon', 'u-late', 'p-new', 'p-old'])
  })

  it('timing follows the dates; live stays live', () => {
    const now = new Date('2026-10-05T10:00:00Z')
    expect(eventTiming({ startDate: '2026-11-01T00:00:00Z' }, now)).toBe('upcoming')
    expect(eventTiming({ startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-06T00:00:00Z' }, now)).toBe('upcoming')
    expect(eventTiming({ startDate: '2026-10-01T00:00:00Z' }, now)).toBe('past')
    expect(eventTiming({ startDate: '2026-10-01T00:00:00Z', status: 'live' }, now)).toBe('live')
  })
})

describe('open, create, patch', () => {
  it('opens a draft as an exact copy of the published event', async () => {
    const f = fake()
    const r = await openEventForEdit(ctx(grant()), 'project-a', E, f.deps)
    expect(r).toEqual({ id: E, rev: 'c1', created: true })
    const created = f.writes[0][1] as Record<string, unknown>
    expect(created._id).toBe(`drafts.${E}`)
    expect(created.gallery).toEqual([{ _key: 'g1' }])
    expect(created.fullDescription).toBeDefined()
  })

  it('creates a draft with the title in the default language and a status from the date', async () => {
    const f = fake()
    await createEvent(ctx(grant()), 'project-a', { title: '  Summer   day ', startDate: '2026-11-01T10:00:00.000Z' }, f.deps)
    expect(f.writes[0][1]).toMatchObject({ _id: 'drafts.new-uuid-1', _type: 'event', projectSlug: 'livener', title: { en: 'Summer day' }, status: 'upcoming' })
  })

  it('create needs a title and a real date', async () => {
    const f = fake()
    await expect(createEvent(ctx(grant()), 'project-a', { title: ' ', startDate: '2026-11-01T10:00:00Z' }, f.deps)).rejects.toMatchObject({ code: 'missing_title' })
    await expect(createEvent(ctx(grant()), 'project-a', { title: 'x', startDate: 'tomorrow' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('patch allowlist: Studio-only fields and identity are refused before any read', async () => {
    const f = fake({ docs: withDraft() })
    for (const path of ['fullDescription.en', 'projectSlug', '_id', 'slug.en', 'title', 'title.en.x', 'gallery', 'status']) {
      await expect(patchEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1', set: { [path]: 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    }
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('patch: site languages only, end not before start, stale revision is a conflict', async () => {
    const f = fake({ docs: withDraft() })
    await expect(patchEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1', set: { 'title.fr': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(patchEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1', set: { endDate: '2026-04-01T00:00:00Z' } }, f.deps)).rejects.toMatchObject({ code: 'bad_dates' })
    await expect(patchEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'old', set: { 'title.en': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.writes).toEqual([])
  })

  it('patch sets, clears and normalises', async () => {
    const f = fake({ docs: withDraft() })
    await patchEventDraft(
      ctx(grant()),
      'project-a',
      { id: E, rev: 'd1', set: { 'location.it': ' Rimini ', 'shortDescription.en': '', registrationUrl: 'example.com/join', endDate: '2026-04-14T18:00:00Z' } },
      f.deps
    )
    expect(f.patchOps).toContainEqual(['ifRevisionId', 'd1'])
    expect(f.patchOps).toContainEqual(['set', { 'location.it': 'Rimini', registrationUrl: 'https://example.com/join', endDate: '2026-04-14T18:00:00.000Z' }])
    expect(f.patchOps).toContainEqual(['unset', ['shortDescription.en']])
  })

  it('sign-up links: web, mailto or a site path; nothing else', () => {
    expect(cleanRegistrationUrl('/contact')).toBe('/contact')
    expect(cleanRegistrationUrl('mailto:info@livener.com')).toBe('mailto:info@livener.com')
    expect(cleanRegistrationUrl('')).toBe('')
    for (const bad of ['javascript:alert(1)', '//evil.com', 'ftp://x.com', 'localhost']) expect(() => cleanRegistrationUrl(bad)).toThrow()
  })

  it('dates must be real and in range', () => {
    expect(parseEventDate('2026-04-12T07:00')).toMatch(/^2026-04-12T/)
    for (const bad of ['', '12/04/2026', '1999-01-01T00:00:00Z', 42]) expect(() => parseEventDate(bad)).toThrow()
  })
})

describe('cover', () => {
  it('only a Media Library photo of this project', async () => {
    const f = fake({ docs: withDraft() })
    await expect(setEventCover(ctx(grant()), 'project-a', { id: E, rev: 'd1', assetId: 'foreign' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
    const r = await setEventCover(ctx(grant()), 'project-a', { id: E, rev: 'd1', assetId: 'm1' }, f.deps)
    expect(r.rev).toBe('d2')
    const set = f.patchOps.find(([op]) => op === 'set')![1] as { heroImage: Record<string, unknown> }
    expect(set.heroImage).toMatchObject({ _type: 'localizedImage', asset: { _ref: 'image-abc-10x10-jpg' }, alt: { en: 'Stand' }, hotspot: { x: 0.4, y: 0.5 } })
  })
})

describe('publish and discard', () => {
  it('publishes the whole draft, keeps existing slugs, adds missing ones, sets status', async () => {
    const f = fake({ docs: withDraft({ title: { en: 'MIR Rimini', it: 'Giornata' } }) })
    await publishEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1' }, f.deps)
    const doc = f.txOps.find(([op]) => op === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc._id).toBe(E)
    expect(doc.gallery).toEqual([{ _key: 'g1' }])
    expect(doc.status).toBe('past')
    expect(doc.slug).toMatchObject({ en: { current: 'mir-rimini' }, it: { current: 'giornata-2' } })
    expect(f.txOps.at(-1)).toEqual(['delete', `drafts.${E}`])
  })

  it('a new event becomes a create; needs a title and a date', async () => {
    const d: Docs = { [`drafts.${E}`]: { _id: `drafts.${E}`, _type: 'event', _rev: 'd1', projectSlug: 'livener', title: { en: 'Summer day' }, startDate: '2026-11-01T10:00:00.000Z' } }
    const f = fake({ docs: d })
    await publishEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1' }, f.deps)
    const created = f.txOps.find(([op]) => op === 'create')![1] as Record<string, unknown>
    expect(created).toMatchObject({ status: 'upcoming', slug: { en: { current: 'summer-day-2' } } })

    const g = fake({ docs: { [`drafts.${E}`]: { ...d[`drafts.${E}`], startDate: undefined } } })
    await expect(publishEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1' }, g.deps)).rejects.toMatchObject({ code: 'missing_date' })
    expect(g.writes).toEqual([])
  })

  it('discarding a never-published event needs delete permission', async () => {
    const d: Docs = { [`drafts.${E}`]: { _id: `drafts.${E}`, _type: 'event', _rev: 'd1', projectSlug: 'livener', title: { en: 'x' } } }
    const f = fake({ docs: d })
    const editorNoDelete = grant({ role: 'editor', permissions: ['events.event.read', 'events.event.write'] })
    await expect(discardEventDraft(ctx(editorNoDelete), 'project-a', { id: E, rev: 'd1' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.writes).toEqual([])
    await expect(discardEventDraft(ctx(grant()), 'project-a', { id: E, rev: 'd1' }, f.deps)).resolves.toEqual({ deleted: true })
  })
})
