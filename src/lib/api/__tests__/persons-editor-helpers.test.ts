/**
 * People editor helpers (agent K): the duplicate check, "View on website" facts,
 * the photo focus read, and creating a Group inline (generic taxonomy service,
 * `people.taxonomy.write`). All permission checks come before any I/O; every
 * read is bound to the GRANT's project.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createTerm, TaxonomyError } from '@/lib/taxonomy/service'
import { findPossibleDuplicates, PERSON_DUPLICATES_QUERY, candidatesFromRows } from '../persons-duplicates'
import { getPersonLiveInfo, getPersonPhotoFocal, PERSON_LIVE_QUERY } from '../persons-live'
import { PersonError } from '../persons-lifecycle'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['people.person.read', 'people.person.write', 'people.taxonomy.write', 'media.library.manage'],
  enabledModuleIds: ['people'],
  ...o,
})
const ctxOf = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const editor = () => ctxOf(grant())
const noRead = () => ctxOf(grant({ role: 'viewer', permissions: [] }))

// ── Duplicates ────────────────────────────────────────────────────────────────

const ROWS = [
  { _id: A, publicId: 'pa', firstName: 'Anna', lastName: 'Rossi' },
  { _id: `drafts.${A}`, publicId: 'pa', firstName: 'Anna', lastName: 'Rossi', displayName: '' },
  { _id: B, publicId: 'pb', firstName: 'Luca', lastName: 'Bianchi', archivedAt: '2026-10-01T00:00:00Z' },
  { _id: C, publicId: 'pc', firstName: 'Anna', lastName: 'Rossi', anonymisedAt: '2026-10-02T00:00:00Z' },
  { _id: '../not an id', publicId: 'px', firstName: 'Anna', lastName: 'Rossi' },
]
const dupClient = (rows: unknown[] = ROWS) => ({ fetch: vi.fn(async () => rows) })

describe('findPossibleDuplicates', () => {
  it('finds the same name once (draft + published are one person), accents and order ignored', async () => {
    const client = dupClient()
    const r = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'ánna', lastName: 'ROSSI' }, { client })
    expect(r.duplicates).toEqual([{ id: A, publicId: 'pa', name: 'Anna Rossi', archived: false }])
    const swapped = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Rossi', lastName: 'Anna' }, { client })
    expect(swapped.duplicates.map((d) => d.id)).toEqual([A])
  })
  it('includes archived people and excludes anonymised ones', async () => {
    const r = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Luca', lastName: 'Bianchi' }, { client: dupClient() })
    expect(r.duplicates).toEqual([{ id: B, publicId: 'pb', name: 'Luca Bianchi', archived: true }])
    // C is anonymised: nothing besides A comes back for Anna Rossi
    const anna = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Anna', lastName: 'Rossi' }, { client: dupClient() })
    expect(anna.duplicates.map((d) => d.id)).toEqual([A])
  })
  it('a person anonymised in the draft only is excluded too', () => {
    const c = candidatesFromRows([
      { _id: D, publicId: 'pd', firstName: 'Zoe', lastName: 'Verdi' },
      { _id: `drafts.${D}`, publicId: 'pd', firstName: 'Zoe', lastName: 'Verdi', anonymisedAt: '2026-10-03T00:00:00Z' },
    ])
    expect(c).toHaveLength(1)
    expect(c[0].anonymised).toBe(true)
  })
  it('one-name people match one-name people only', async () => {
    const rows = [{ _id: D, publicId: 'pd', firstName: 'Madonna', lastName: '' }, ...ROWS]
    const r = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Madonna', lastName: '' }, { client: dupClient(rows) })
    expect(r.duplicates.map((d) => d.id)).toEqual([D])
    const none = await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Anna', lastName: '' }, { client: dupClient(rows) })
    expect(none.duplicates).toEqual([])
  })
  it('refuses without people.person.read before reading anything', async () => {
    const client = dupClient()
    await expect(findPossibleDuplicates(noRead(), 'project-a', { firstName: 'Anna', lastName: 'Rossi' }, { client })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(client.fetch).not.toHaveBeenCalled()
  })
  it('refuses a project the caller has no grant for', async () => {
    const client = dupClient()
    await expect(findPossibleDuplicates(editor(), 'project-b', { firstName: 'Anna', lastName: 'Rossi' }, { client })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(client.fetch).not.toHaveBeenCalled()
  })
  it('reads only the grant’s project, from the raw perspective', async () => {
    const client = dupClient()
    await findPossibleDuplicates(editor(), 'project-a', { firstName: 'Anna', lastName: 'Rossi' }, { client })
    expect(client.fetch).toHaveBeenCalledWith(PERSON_DUPLICATES_QUERY, { projectSlug: 'cyce' }, { perspective: 'raw' })
    expect(PERSON_DUPLICATES_QUERY).toContain('projectSlug == $projectSlug')
  })
  it('a blank name makes no read at all', async () => {
    const client = dupClient()
    expect((await findPossibleDuplicates(editor(), 'project-a', { firstName: ' ', lastName: '' }, { client })).duplicates).toEqual([])
    expect(client.fetch).not.toHaveBeenCalled()
  })
})

// ── View on website facts ─────────────────────────────────────────────────────

describe('getPersonLiveInfo', () => {
  const liveClient = (r: unknown) => ({ fetch: vi.fn(async () => r) })
  it('reads the published person, the canonical origin and the cleaned profile segments', async () => {
    const client = liveClient({
      person: { visibility: 'page', slug: { _type: 'localizedSlug', it: { current: 'anna-rossi' }, en: { current: '' } } },
      domain: 'CYCE.info',
      segment: { _type: 'localizedString', it: 'insegnanti', en: 'Bad Segment', de: 'blog' },
    })
    const info = await getPersonLiveInfo(editor(), 'project-a', { id: A }, { client })
    expect(info).toEqual({
      origin: 'https://www.cyce.info',
      published: true,
      archived: false,
      anonymised: false,
      visibility: 'page',
      slugs: { it: 'anna-rossi' },
      segments: { it: 'insegnanti' }, // invalid and reserved segments are dropped
    })
    expect(client.fetch).toHaveBeenCalledWith(PERSON_LIVE_QUERY, { id: A, projectSlug: 'cyce', moduleId: 'people' }, { perspective: 'raw' })
  })
  it('not published ⇒ published false; no domain ⇒ no origin', async () => {
    const info = await getPersonLiveInfo(editor(), 'project-a', { id: A }, { client: liveClient({ person: null, domain: null, segment: null }) })
    expect(info.published).toBe(false)
    expect(info.origin).toBeNull()
  })
  it('archived / anonymised published people are reported as such', async () => {
    const info = await getPersonLiveInfo(editor(), 'project-a', { id: A }, { client: liveClient({ person: { visibility: 'page', archivedAt: 'x', anonymisedAt: 'y' } }) })
    expect(info).toMatchObject({ archived: true, anonymised: true })
  })
  it('permission and id are checked before any read', async () => {
    const client = liveClient({})
    await expect(getPersonLiveInfo(noRead(), 'project-a', { id: A }, { client })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(getPersonLiveInfo(editor(), 'project-a', { id: 'drafts.x' }, { client })).rejects.toBeInstanceOf(PersonError)
    expect(client.fetch).not.toHaveBeenCalled()
  })
  it('the person is looked up by id AND the grant’s project', () => {
    expect(PERSON_LIVE_QUERY).toContain('projectSlug == $projectSlug')
    expect(PERSON_LIVE_QUERY).toContain('_id == $id')
  })
})

// ── Photo focus point ─────────────────────────────────────────────────────────

describe('getPersonPhotoFocal', () => {
  it('returns the asset original URL, revision and hotspot centre; scoped to the grant’s project', async () => {
    const client = { fetch: vi.fn(async (_q: string, _p: Record<string, unknown>) => ({ _rev: 'r1', url: 'https://cdn.sanity.io/x.jpg', hotspot: { x: 0.3, y: 0.7, width: 0.3, height: 0.3 } })) }
    const r = await getPersonPhotoFocal(editor(), 'project-a', { assetId: 'asset-1' }, { client })
    expect(r).toEqual({ assetId: 'asset-1', rev: 'r1', url: 'https://cdn.sanity.io/x.jpg', focal: { x: 0.3, y: 0.7 } })
    expect(client.fetch.mock.calls[0][1]).toEqual({ id: 'asset-1', projectSlug: 'cyce' })
    expect(String(client.fetch.mock.calls[0][0])).toContain('projectSlug == $projectSlug')
  })
  it('no hotspot ⇒ focal null; another project’s or a missing asset ⇒ not_found', async () => {
    const some = { fetch: vi.fn(async () => ({ _rev: 'r', url: 'u' })) }
    expect((await getPersonPhotoFocal(editor(), 'project-a', { assetId: 'a' }, { client: some })).focal).toBeNull()
    await expect(getPersonPhotoFocal(editor(), 'project-a', { assetId: 'a' }, { client: { fetch: vi.fn(async () => null) } })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('needs the Media permission, before any read', async () => {
    const client = { fetch: vi.fn() }
    const noMedia = ctxOf(grant({ permissions: ['people.person.read', 'people.person.write'] }))
    await expect(getPersonPhotoFocal(noMedia, 'project-a', { assetId: 'a' }, { client })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(getPersonPhotoFocal(editor(), 'project-a', { assetId: '../x' }, { client })).rejects.toMatchObject({ code: 'not_found' })
    expect(client.fetch).not.toHaveBeenCalled()
  })
})

// ── Creating a Group inline (generic taxonomy service) ───────────────────────

describe('inline Group creation', () => {
  function sanity() {
    const created: Record<string, unknown>[] = []
    const fetch = vi.fn(async (q: string) => {
      if (q.startsWith('count(*[_type == "project"')) return 1
      if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'en'] }
      if (q.includes('_type == "taxonomyTerm"')) return created
      throw new Error(`unexpected query ${q}`)
    })
    const createIfNotExists = vi.fn(async (doc: Record<string, unknown>) => {
      created.push(doc)
      return doc
    })
    return { created, fetch, createIfNotExists, deps: { client: { fetch, createIfNotExists, getDocument: vi.fn() } as never, now: () => new Date('2026-11-03T09:00:00Z') } }
  }

  it('creates a People group term in the People module/category vocabulary with people.taxonomy.write', async () => {
    const s = sanity()
    const r = await createTerm(editor(), 'project-a', 'people', 'category', { labels: { it: 'Insegnanti' } }, s.deps)
    expect(r.created).toBe(true)
    expect(s.created[0]).toMatchObject({ _type: 'taxonomyTerm', projectSlug: 'cyce', module: 'people', kind: 'category' })
    expect(r.term.key).toBeTruthy()
  })
  it('a same-named group is handed back, not duplicated', async () => {
    const s = sanity()
    await createTerm(editor(), 'project-a', 'people', 'category', { labels: { it: 'Insegnanti' } }, s.deps)
    const again = await createTerm(editor(), 'project-a', 'people', 'category', { labels: { it: ' insegnanti ' } }, s.deps)
    expect(again.created).toBe(false)
    expect(s.created).toHaveLength(1)
  })
  it('people.person.write alone is not enough: refused before any I/O', async () => {
    const s = sanity()
    const withoutTaxonomy = ctxOf(grant({ permissions: ['people.person.read', 'people.person.write'] }))
    await expect(createTerm(withoutTaxonomy, 'project-a', 'people', 'category', { labels: { it: 'X' } }, s.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(s.fetch).not.toHaveBeenCalled()
    expect(s.createIfNotExists).not.toHaveBeenCalled()
  })
  it('same validation as Categories & Tags: the main language label is required', async () => {
    const s = sanity()
    await expect(createTerm(editor(), 'project-a', 'people', 'category', { labels: { en: 'Teachers' } }, s.deps)).rejects.toBeInstanceOf(TaxonomyError)
    expect(s.createIfNotExists).not.toHaveBeenCalled()
  })
  it('People has groups (category) but no tags', async () => {
    const s = sanity()
    await expect(createTerm(editor(), 'project-a', 'people', 'tag', { labels: { it: 'X' } }, s.deps)).rejects.toMatchObject({ code: 'kind_not_declared' })
  })
})
