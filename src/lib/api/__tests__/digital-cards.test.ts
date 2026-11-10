/**
 * Digital Cards in the client dashboard (ADR-049). Every refusal happens BEFORE
 * any write; identity comes from the grant; one site card per project, one card
 * per person; URL names unique across current AND retired names; publishing a
 * person card needs the person and a valid URL name; statistics behind
 * digital-cards.stats.read with the grant's project slug.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  archiveDigitalCard,
  checkDigitalCardUrlName,
  createPersonCard,
  createSiteCard,
  deleteDigitalCardDraft,
  deleteDigitalCardPermanently,
  discardDigitalCardDraft,
  getDigitalCard,
  getDigitalCardStats,
  getDigitalCardsOverview,
  listDigitalCards,
  openDigitalCardForEdit,
  publishBlockers,
  publishDigitalCardDraft,
  restoreDigitalCard,
  runDigitalCardLifecycle,
  saveDigitalCardDraft,
  unpublishDigitalCard,
  DigitalCardError,
} from '../digital-cards'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const SITE = 'card-site'
const CARD = 'card-anna'
const PUBLIC_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT = 'project-a'
const ALL = ['digital-cards.read', 'digital-cards.write', 'digital-cards.delete', 'digital-cards.stats.read']

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PROJECT,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['digital-cards', 'people'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['digital-cards.read', 'digital-cards.write', 'digital-cards.stats.read'] })
const viewer = () => grant({ role: 'viewer', permissions: ['digital-cards.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const baseDocs = (): Docs => ({
  [SITE]: { _id: SITE, _type: 'digitalCard', _rev: 's1', projectSlug: 'cyce', publicId: '33333333-3333-4333-8333-333333333333', kind: 'site', links: [], background: { _type: 'reference', _ref: 'img-1' } },
  [CARD]: {
    _id: CARD,
    _type: 'digitalCard',
    _rev: 'p1',
    projectSlug: 'cyce',
    publicId: PUBLIC_ID,
    kind: 'person',
    person: { _type: 'reference', _ref: 'person-anna', _weak: true },
    urlName: 'anna-rossi',
    links: [{ _key: 'l1', _type: 'digitalCardLink', kind: 'url', url: 'https://example.com/', hidden: false, primary: true }],
  },
  [`drafts.${CARD}`]: {
    _id: `drafts.${CARD}`,
    _type: 'digitalCard',
    _rev: 'd1',
    projectSlug: 'cyce',
    publicId: PUBLIC_ID,
    kind: 'person',
    person: { _type: 'reference', _ref: 'person-anna', _weak: true },
    urlName: 'anna',
    links: [{ _key: 'l1', _type: 'digitalCardLink', kind: 'url', url: 'https://example.com/', hidden: false, primary: true }],
  },
  retired: { _id: 'retired', _type: 'digitalCard', _rev: 'r1', projectSlug: 'cyce', kind: 'person', person: { _ref: 'person-old' }, urlName: 'mario', retiredUrlNames: ['old-name'] },
  other: { _id: 'other', _type: 'digitalCard', _rev: 'o1', projectSlug: 'livener', kind: 'site' },
  notone: { _id: 'notone', _type: 'post', _rev: 'x1', projectSlug: 'cyce' },
})
const archivedDocs = (): Docs => {
  const d = baseDocs()
  d[CARD] = { ...d[CARD], archivedAt: '2026-10-10T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z' }
  delete d[`drafts.${CARD}`]
  return d
}

const PEOPLE = [
  {
    _id: 'person-anna',
    firstName: 'Anna',
    lastName: 'Rossi',
    jobTitle: { it: 'Insegnante' },
    photoUrl: 'https://cdn/x.jpg',
    contacts: [
      { _key: 'c1', kind: 'phone', value: '+39 333 1234567' },
      { _key: 'c2', kind: 'instagram', value: 'https://instagram.com/anna' },
    ],
    visibility: 'page',
    anonymised: false,
    archived: false,
    slug: { it: { current: 'anna-rossi' } },
  },
  { _id: 'person-sofia', firstName: 'Sofia', lastName: 'Rossi', visibility: 'listed', anonymised: false, archived: false, slug: { it: { current: 'anna-rossi' } } },
  { _id: 'person-luca', firstName: 'Mario', lastName: '', visibility: 'listed', anonymised: false, archived: false },
  { _id: 'person-off', firstName: 'Off', lastName: 'Person', visibility: 'off', anonymised: false, archived: false },
]

/** Documents a link may reference, by id → type (this project's only). */
const TARGET_TYPES: Record<string, string> = {
  'page-1': 'page',
  'tmz-catalogue-page': 'cataloguePage',
  'tmz-collection-douglas-adams': 'catalogueCollection',
  'tmz-item-good-omens': 'catalogueItem',
}

/** The page picker's read for a tmz-shaped project (Amendment B): pages, the catalogue, module installations. */
const TMZ_TARGET_ROWS = (catalogue: boolean) => ({
  pages: [
    { _id: 'tmz-page-home', pageType: 'home', title: 'Home', slug: 'home' },
    { _id: 'tmz-page-downloads', pageType: 'standard', title: 'Downloads', slug: 'downloads' },
    { _id: 'tmz-page-privacy', pageType: 'legal', title: 'Privacy', slug: 'privacy' },
  ],
  catalogue: catalogue
    ? [
        { _id: 'tmz-collection-douglas-adams', _type: 'catalogueCollection', title: 'Douglas Adams', slug: 'douglas-adams' },
        { _id: 'tmz-item-good-omens', _type: 'catalogueItem', title: 'Good Omens', slug: 'good-omens' },
        { _id: 'tmz-catalogue-page', _type: 'cataloguePage', title: 'Between the Lines', slug: null },
      ]
    : null,
  modules: [
    { moduleId: 'catalogue', segment: 'books' },
    { moduleId: 'blog', segment: null },
    { moduleId: 'events', segment: null },
  ],
})

function fake(opts: { docs?: Docs; people?: any[]; site?: any; commitError?: unknown; pages?: string[]; files?: string[]; targetRows?: (p: Record<string, unknown>) => unknown } = {}) {
  const docs = opts.docs ?? baseDocs()
  const people = opts.people ?? PEOPLE
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
    if (q.includes('"config": *[_type == "siteConfig"')) {
      return (
        opts.site ?? {
          config: {
            siteName: 'CYCE',
            defaultLocale: 'it',
            supportedLocales: ['it', 'en'],
            phone: '+32 2 000000',
            email: '',
            hasLogo: true,
            socialLinks: [{ _key: 's1', platform: 'instagram', url: 'https://instagram.com/cyce' }],
            locations: [{ _key: 'loc1', name: { it: 'Sala' }, city: 'Bruxelles' }],
          },
          project: { customDomain: 'cyce.info', whatsappNumber: null },
        }
      )
    }
    if (q.includes('_type == "digitalCard"') && q.includes('order(_updatedAt desc)')) {
      return Object.values(docs)
        .filter((d) => d._type === 'digitalCard' && d.projectSlug === p.projectSlug)
        .map((d) => ({ ...d, _updatedAt: '2026-11-01T00:00:00Z', _createdAt: '2026-10-01T00:00:00Z' }))
    }
    if (q.includes('kind == "site"') && q.includes('.background._ref')) return 'img-1'
    if (q.includes('_type == "person"')) {
      const ids = p.ids as string[] | undefined
      return people.filter((x) => !ids || ids.includes(x._id))
    }
    if (q.includes('_type == "mediaAsset"') && q.includes('_id in $ids && defined(image.asset)]._id')) return (p.ids as string[]).filter((i) => (opts.files ?? ['img-1', 'img-2']).includes(i))
    if (q.includes('_type == "mediaAsset"') && q.includes('[0]{ "url"')) return p.id === 'img-1' ? { url: 'https://cdn/bg.jpg', alt: { it: 'Sfondo' } } : null
    if (q.includes('_type == "mediaAsset"') && q.includes('defined(image.asset)][0]._id')) return (opts.files ?? ['img-1', 'img-2']).includes(p.id as string) ? p.id : null
    if (q.includes('_type == "mediaAsset"') && q.includes('_id in $ids]._id')) return (p.ids as string[]).filter((i) => (opts.files ?? ['img-1', 'file-1']).includes(i))
    if (q.includes('_type == "mediaAsset"') && q.includes('_id in $ids]{')) return (p.ids as string[]).map((i) => ({ _id: i, name: `${i}.pdf` }))
    if (q.includes('"catalogue": select($catalogue')) return opts.targetRows ? opts.targetRows(p) : { pages: [{ _id: 'page-1', title: 'Contatti', pageType: 'standard', slug: 'contatti' }], catalogue: null, modules: [] }
    if (q.includes('_type in $types') && q.includes('_id in $ids]._id')) return (p.ids as string[]).filter((i) => (p.types as string[]).includes(TARGET_TYPES[i]))
    if (q.includes('_type == "page"') && q.includes('_id in $ids]._id')) return (p.ids as string[]).filter((i) => (opts.pages ?? ['page-1']).includes(i))
    if (q.includes('_type == "page"')) return [{ _id: 'page-1', title: 'Contatti' }]
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
  const readStats = vi.fn(async () => ({ available: true as const, stats: { totals: { visits: 10, clicks: 3 }, cards: [], links: [], sources: [], days: [] } }))
  let n = 0
  return {
    client,
    writes,
    patchOps,
    txOps,
    created,
    readStats,
    deps: {
      client: client as never,
      uuid: () => (++n === 1 ? 'new-card-1' : '22222222-2222-4222-8222-222222222222'),
      now: () => new Date('2026-11-09T10:00:00Z'),
      audit,
      stats: { readStats },
    },
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const calls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>) => [
    () => createSiteCard(c, PROJECT, f.deps),
    () => createPersonCard(c, PROJECT, { personId: 'person-sofia' }, f.deps),
    () => openDigitalCardForEdit(c, PROJECT, { id: CARD }, f.deps),
    () => saveDigitalCardDraft(c, PROJECT, { id: CARD, rev: 'd1', set: { 'show.phone': true } }, f.deps),
    () => publishDigitalCardDraft(c, PROJECT, { id: CARD, rev: 'd1' }, f.deps),
    () => discardDigitalCardDraft(c, PROJECT, { id: CARD, rev: 'd1' }, f.deps),
    () => checkDigitalCardUrlName(c, PROJECT, { id: CARD, urlName: 'x' }, f.deps),
    () => unpublishDigitalCard(c, PROJECT, { id: CARD }, f.deps),
    () => archiveDigitalCard(c, PROJECT, { id: CARD }, f.deps),
    () => restoreDigitalCard(c, PROJECT, { id: CARD }, f.deps),
    () => deleteDigitalCardDraft(c, PROJECT, { id: CARD }, f.deps),
    () => deleteDigitalCardPermanently(c, PROJECT, { id: CARD }, f.deps),
  ]
  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without the Digital Cards module', ctx(grant({ enabledModuleIds: ['people'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of calls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.client.fetch).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('a viewer can read, an unknown project cannot', async () => {
    const f = fake()
    await expect(listDigitalCards(ctx(viewer()), PROJECT, f.deps)).resolves.toBeDefined()
    await expect(getDigitalCard(ctx(viewer()), PROJECT, CARD, f.deps)).resolves.toBeDefined()
    await expect(listDigitalCards(ctx(viewer()), 'project-zzz', f.deps)).rejects.toThrow(TenantAuthorizationError)
  })

  it('statistics need digital-cards.stats.read — a viewer is refused before any read', async () => {
    const f = fake()
    await expect(getDigitalCardStats(ctx(viewer()), PROJECT, { id: CARD, days: 30 }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.readStats).not.toHaveBeenCalled()
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('only the owner may delete permanently — an editor is refused before any read', async () => {
    const f = fake({ docs: archivedDocs() })
    await expect(deleteDigitalCardPermanently(ctx(editor()), PROJECT, { id: CARD }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })
})

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('ids cannot be probed across projects or types', () => {
  it.each(['other', 'notone', 'missing', '../etc', 'drafts.x'])('%s is not_found everywhere', async (id) => {
    const f = fake()
    const c = ctx(grant())
    for (const call of [
      () => getDigitalCard(c, PROJECT, id, f.deps),
      () => openDigitalCardForEdit(c, PROJECT, { id }, f.deps),
      () => saveDigitalCardDraft(c, PROJECT, { id, rev: 'x', set: { 'show.phone': true } }, f.deps),
      () => publishDigitalCardDraft(c, PROJECT, { id, rev: 'x' }, f.deps),
      () => archiveDigitalCard(c, PROJECT, { id }, f.deps),
      () => getDigitalCardStats(c, PROJECT, { id, days: 7 }, f.deps),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.writes).toEqual([])
  })
})

// ── List and read ─────────────────────────────────────────────────────────────

describe('list and read', () => {
  it('lists the site card first, then person cards, with the people still without a card', async () => {
    const r = await listDigitalCards(ctx(viewer()), PROJECT, fake().deps)
    expect(r.cards.map((c) => c.id)).toEqual([SITE, CARD, 'retired'])
    expect(r.cards[0]).toMatchObject({ kind: 'site', path: '/card', title: '' })
    expect(r.cards[1]).toMatchObject({ kind: 'person', title: 'Anna Rossi', urlName: 'anna', path: '/card/anna', hasChanges: true, personMissing: false, linkCount: 1 })
    // person-old is not among the published people: the card is marked offline.
    expect(r.cards[2]).toMatchObject({ personMissing: true })
    expect(r.people.map((p) => p.id)).toEqual(['person-sofia', 'person-luca'])
    expect(r).toMatchObject({ siteName: 'CYCE', hasSiteCard: true, origin: 'https://www.cyce.info', site: { defaultLocale: 'it', languages: ['it', 'en'] } })
  })

  it('reads the draft with the switches resolved over the defaults and what data exists', async () => {
    const card = await getDigitalCard(ctx(viewer()), PROJECT, CARD, fake().deps)
    expect(card).toMatchObject({ kind: 'person', urlName: 'anna', publishedUrlName: 'anna-rossi', rev: 'd1', path: '/card/anna', origin: 'https://www.cyce.info' })
    expect(card.person).toMatchObject({ id: 'person-anna', name: 'Anna Rossi', firstName: 'Anna', live: true })
    // Amendment A: social profiles on by default (nothing hidden); contacts stay off (D7)
    expect(card.show).toMatchObject({ photo: true, name: true, role: true, phone: false, email: false, whatsapp: false, saveContact: false, nameMode: 'full', socials: ['c2'], hiddenSocials: [] })
    expect(card.availability).toMatchObject({ phone: true, email: false, whatsapp: false, photo: true, role: true, profilePage: true, reservations: false })
    // the real values "What's on your card" shows (public People contacts only)
    expect(card.availability.values).toEqual({ phone: '+39 333 1234567', email: '', whatsapp: '', role: 'Insegnante' })
    expect(card.availability.socials).toEqual([{ key: 'c2', label: 'instagram', detail: 'https://instagram.com/anna' }])
    // D4 — a person card without its own background shows the site card's.
    expect(card.background).toBeNull()
    expect(card.inheritedBackground).toMatchObject({ assetId: 'img-1', url: 'https://cdn/bg.jpg' })
    expect(card.links).toEqual([{ key: 'l1', kind: 'url', label: {}, description: {}, url: 'https://example.com/', page: null, file: null, logo: null, value: '', hidden: false, primary: true }])
  })

  it('Amendment B — the page picker lists pages, the Catalogue (Between the Lines, collections, items) and the sections that are on, titled in the default language', async () => {
    const seen: Record<string, unknown>[] = []
    const f = fake({ targetRows: (p) => (seen.push(p), TMZ_TARGET_ROWS(p.catalogue === true)) })
    const card = await getDigitalCard(ctx(grant({ enabledModuleIds: ['digital-cards', 'catalogue', 'blog', 'events'] })), PROJECT, SITE, f.deps)
    expect(seen[0]).toMatchObject({ projectSlug: 'cyce', defaultLocale: 'it', catalogue: true, catalogueTypes: ['cataloguePage', 'catalogueCollection', 'catalogueItem'] })
    expect(card.pages).toEqual([
      { id: 'tmz-page-home', title: 'Home', group: 'pages', type: 'page', path: '' },
      { id: 'tmz-page-downloads', title: 'Downloads', group: 'pages', type: 'page', path: 'downloads' },
      { id: 'tmz-page-privacy', title: 'Privacy', group: 'pages', type: 'page', path: 'privacy' },
      // the landing page first, then collections, then items
      { id: 'tmz-catalogue-page', title: 'Between the Lines', group: 'catalogue', type: 'cataloguePage', path: 'books' },
      { id: 'tmz-collection-douglas-adams', title: 'Douglas Adams', group: 'catalogue', type: 'catalogueCollection', path: 'books/douglas-adams' },
      { id: 'tmz-item-good-omens', title: 'Good Omens', group: 'catalogue', type: 'catalogueItem', path: 'books/good-omens' },
      // sections whose module is on (Home is a page already; no News / Live), in the site's default language (it)
      { id: 'section:blog', title: 'Blog', group: 'sections', type: 'section' },
      { id: 'section:events', title: 'Eventi', group: 'sections', type: 'section' },
    ])
    // Catalogue off → no catalogue targets are read or offered.
    const off = await getDigitalCard(ctx(grant({ enabledModuleIds: ['digital-cards'] })), PROJECT, SITE, fake({ targetRows: (p) => TMZ_TARGET_ROWS(p.catalogue === true) }).deps)
    expect(off.pages.map((o) => o.id)).toEqual(['tmz-page-home', 'tmz-page-downloads', 'tmz-page-privacy'])
  })

  it('the site card switches start with everything that exists on', async () => {
    const card = await getDigitalCard(ctx(viewer()), PROJECT, SITE, fake().deps)
    expect(card.show).toMatchObject({ logo: true, businessName: true, phone: true, socials: ['instagram'], locations: ['loc1'] })
    expect(card.availability).toMatchObject({ logo: true, phone: true, email: false, socials: [{ key: 'instagram' }], locations: [{ key: 'loc1', label: 'Sala' }] })
    expect(card.availability.values).toEqual({ phone: '+32 2 000000', email: '', whatsapp: '', role: '' })
    expect(card.inheritedBackground).toBeNull()
  })

  it('no custom domain → no canonical origin (no QR code, no tagged links)', async () => {
    const f = fake({ site: { config: { siteName: 'X', defaultLocale: 'it', supportedLocales: ['it'] }, project: { customDomain: null } } })
    expect((await getDigitalCard(ctx(viewer()), PROJECT, SITE, f.deps)).origin).toBeNull()
  })
})

// ── Create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('a site card is refused while the project has one (D2)', async () => {
    const f = fake()
    await expect(createSiteCard(ctx(editor()), PROJECT, f.deps)).rejects.toMatchObject({ code: 'site_exists' })
    expect(f.writes).toEqual([])
  })

  it('creates the site card as a draft with the identity from the grant', async () => {
    const docs = baseDocs()
    delete docs[SITE]
    const f = fake({ docs })
    const r = await createSiteCard(ctx(editor()), PROJECT, f.deps)
    expect(r).toMatchObject({ id: 'new-card-1', publicId: '22222222-2222-4222-8222-222222222222' })
    expect(f.created[0]).toEqual({ _id: 'drafts.new-card-1', _type: 'digitalCard', projectSlug: 'cyce', publicId: '22222222-2222-4222-8222-222222222222', kind: 'site', links: [] })
  })

  it('a person card refuses a person who already has one, or who is off / unknown', async () => {
    const f = fake()
    await expect(createPersonCard(ctx(editor()), PROJECT, { personId: 'person-anna' }, f.deps)).rejects.toMatchObject({ code: 'person_has_card' })
    await expect(createPersonCard(ctx(editor()), PROJECT, { personId: 'person-off' }, f.deps)).rejects.toMatchObject({ code: 'person_not_found' })
    await expect(createPersonCard(ctx(editor()), PROJECT, { personId: 'nobody' }, f.deps)).rejects.toMatchObject({ code: 'person_not_found' })
    await expect(createPersonCard(ctx(editor()), PROJECT, { personId: 'drafts.person-sofia' }, f.deps)).rejects.toMatchObject({ code: 'person_not_found' })
    expect(f.writes).toEqual([])
  })

  it('suggests the URL name: People slug when free, else the full name, else with a number (D5)', async () => {
    // Sofia's People slug "anna-rossi" is taken (published name of Anna's card): falls back to her name.
    const f = fake()
    const r = await createPersonCard(ctx(editor()), PROJECT, { personId: 'person-sofia' }, f.deps)
    expect(r.urlName).toBe('sofia-rossi')
    expect(f.created[0]).toMatchObject({ _id: 'drafts.new-card-1', kind: 'person', projectSlug: 'cyce', person: { _type: 'reference', _ref: 'person-sofia', _weak: true }, urlName: 'sofia-rossi' })
    // "mario" is used by another card: the next free one.
    const g = fake()
    expect((await createPersonCard(ctx(editor()), PROJECT, { personId: 'person-luca' }, g.deps)).urlName).toBe('mario-2')
  })
})

// ── Save ──────────────────────────────────────────────────────────────────────

describe('saveDigitalCardDraft', () => {
  const save = (set: Record<string, unknown>, f = fake(), c = ctx(editor())) => saveDigitalCardDraft(c, PROJECT, { id: CARD, rev: 'd1', set }, f.deps)

  it.each(['_id', '_type', 'projectSlug', 'publicId', 'kind', 'person', 'retiredUrlNames', 'expiresAt', 'archivedAt', 'show', 'description', 'links.0', 'show.a.b'])('"%s" cannot be changed here', async (path) => {
    const f = fake()
    await expect(save({ [path]: 'x' }, f)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('saves switches, the description and the background, revision-guarded', async () => {
    const f = fake()
    expect(await save({ 'show.phone': true, 'show.nameMode': 'first', 'show.hiddenSocials': ['c2', 'c2'], 'description.en': ' Yoga teacher ', background: 'img-2' }, f)).toEqual({ rev: 'd2' })
    expect(f.patchOps).toContainEqual(['ifRevisionId', 'd1'])
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as Record<string, unknown>
    expect(set).toEqual({ 'show.phone': true, 'show.nameMode': 'first', 'show.hiddenSocials': ['c2'], 'description.en': 'Yoga teacher', background: { _type: 'reference', _ref: 'img-2' } })
  })

  it('refuses switches of the other kind, wrong values and unknown languages', async () => {
    await expect(save({ 'show.logo': true })).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ 'show.locations': ['x'] })).rejects.toMatchObject({ code: 'invalid_field' })
    // Amendment A: the old shown-list is no longer written
    await expect(save({ 'show.socials': ['c2'] })).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ 'show.hiddenSocials': ['bad id!'] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ 'show.phone': 'yes' })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ 'show.nameMode': 'nick' })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ 'description.fr': 'x' })).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(save({ background: 'img-foreign' })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('URL names: well formed and unique across current AND retired names of the other cards (D5)', async () => {
    await expect(save({ urlName: 'Anna Rossi' })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ urlName: 'mario' })).rejects.toMatchObject({ code: 'url_name_taken' })
    await expect(save({ urlName: 'old-name' })).rejects.toMatchObject({ code: 'url_name_taken' })
    // Its own (published) name is free for itself.
    const f = fake()
    await save({ urlName: 'anna-rossi' }, f)
    expect(f.patchOps.find((o) => o[0] === 'set')![1]).toEqual({ urlName: 'anna-rossi' })
  })

  it('a site card has no URL name', async () => {
    const docs = baseDocs()
    docs[`drafts.${SITE}`] = { ...docs[SITE], _id: `drafts.${SITE}`, _rev: 'sd1' }
    const f = fake({ docs })
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: SITE, rev: 'sd1', set: { urlName: 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
  })

  it('rebuilds links server-side and checks every target', async () => {
    const f = fake()
    await save(
      {
        links: [
          { key: 'a', kind: 'url', label: { it: ' Sito ', en: '' }, url: 'https://cyce.info/x', hidden: false, primary: true, extra: 'dropped' },
          { key: 'b', kind: 'page', page: 'page-1', hidden: true },
          { key: 'c', kind: 'phone', value: '+39 333 1234567' },
          { key: 'd', kind: 'file', file: 'file-1' },
          { key: 'e', kind: 'email', value: '' },
        ],
      },
      f
    )
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as { links: any[] }
    expect(set.links).toEqual([
      { _key: 'a', _type: 'digitalCardLink', kind: 'url', label: { _type: 'localizedString', it: 'Sito' }, url: 'https://cyce.info/x', hidden: false, primary: true },
      { _key: 'b', _type: 'digitalCardLink', kind: 'page', page: { _type: 'reference', _ref: 'page-1', _weak: true }, hidden: true, primary: false },
      { _key: 'c', _type: 'digitalCardLink', kind: 'phone', value: '+39 333 1234567', hidden: false, primary: false },
      { _key: 'd', _type: 'digitalCardLink', kind: 'file', file: { _type: 'reference', _ref: 'file-1' }, hidden: false, primary: false },
      { _key: 'e', _type: 'digitalCardLink', kind: 'email', hidden: false, primary: false },
    ])
  })

  it('a link may carry a logo: a Media Library image of this project, stored as a reference on any kind', async () => {
    const f = fake()
    await save({ links: [{ key: 'a', kind: 'url', url: 'https://cyce.info/x', logo: 'img-2' }, { key: 'b', kind: 'phone', value: '+39 333 1234567', logo: null }, { key: 'c', kind: 'email', value: '', logo: '' }] }, f)
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as { links: any[] }
    expect(set.links[0]).toEqual({ _key: 'a', _type: 'digitalCardLink', kind: 'url', url: 'https://cyce.info/x', logo: { _type: 'reference', _ref: 'img-2' }, hidden: false, primary: false })
    expect(set.links[1]).not.toHaveProperty('logo')
    expect(set.links[2]).not.toHaveProperty('logo')
  })

  it('refuses a logo that is not an image of this project, a draft id or a non-text value', async () => {
    await expect(save({ links: [{ key: 'a', kind: 'url', url: 'https://a.example', logo: 'img-foreign' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url', url: 'https://a.example', logo: 'drafts.img-2' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url', url: 'https://a.example', logo: { _ref: 'img-2' } }] })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('refuses two shown Primary Actions, booking without Reservations, foreign pages and bad values', async () => {
    const two = [
      { key: 'a', kind: 'url', primary: true },
      { key: 'b', kind: 'url', primary: true },
    ]
    await expect(save({ links: two })).rejects.toMatchObject({ code: 'invalid_value' })
    // A hidden second primary is fine.
    await expect(save({ links: [two[0], { ...two[1], hidden: true }] })).resolves.toEqual({ rev: 'd2' })
    await expect(save({ links: [{ key: 'a', kind: 'booking' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'booking' }] }, fake(), ctx(editor()))).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'booking' }] }, fake(), ctx({ ...editor(), enabledModuleIds: ['digital-cards', 'reservations'] }))).resolves.toEqual({ rev: 'd2' })
    await expect(save({ links: [{ key: 'a', kind: 'page', page: 'page-foreign' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url', url: 'javascript:alert(1)' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'email', value: 'not-an-email' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'phone', value: 'call me' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url' }, { key: 'a', kind: 'url' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'sms' }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, kind: 'url' })) })).rejects.toMatchObject({ code: 'too_large' })
  })

  it('Amendment B — a page link reaches the catalogue landing page, collections, items, sections and module pages (navigationLink-shaped)', async () => {
    const f = fake()
    const tmz = ctx({ ...editor(), enabledModuleIds: ['digital-cards', 'catalogue', 'blog'] })
    await save(
      {
        links: [
          { key: 'a', kind: 'page', page: 'tmz-catalogue-page' },
          { key: 'b', kind: 'page', page: 'tmz-collection-douglas-adams', internalPage: null, moduleId: null },
          { key: 'c', kind: 'page', page: 'tmz-item-good-omens' },
          { key: 'd', kind: 'page', page: null, internalPage: 'blog' },
          { key: 'e', kind: 'page', internalPage: 'homepage' },
          { key: 'f', kind: 'page', moduleId: 'catalogue' },
          // A page reference stored before Amendment B works as before.
          { key: 'g', kind: 'page', page: 'page-1' },
        ],
      },
      f,
      tmz
    )
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as { links: any[] }
    const ref = (id: string) => ({ _type: 'reference', _ref: id, _weak: true })
    expect(set.links.map((l) => ({ page: l.page, internalPage: l.internalPage, moduleId: l.moduleId }))).toEqual([
      { page: ref('tmz-catalogue-page'), internalPage: undefined, moduleId: undefined },
      { page: ref('tmz-collection-douglas-adams'), internalPage: undefined, moduleId: undefined },
      { page: ref('tmz-item-good-omens'), internalPage: undefined, moduleId: undefined },
      { page: undefined, internalPage: 'blog', moduleId: undefined },
      { page: undefined, internalPage: 'homepage', moduleId: undefined },
      { page: undefined, internalPage: undefined, moduleId: 'catalogue' },
      { page: ref('page-1'), internalPage: undefined, moduleId: undefined },
    ])
    // The references are checked against this project with the catalogue types allowed.
    const check = f.client.fetch.mock.calls.find((c) => String(c[0]).includes('_type in $types'))!
    expect(check[1]).toMatchObject({ projectSlug: 'cyce', types: ['page', 'cataloguePage', 'catalogueCollection', 'catalogueItem'] })
  })

  it('Amendment B — refuses a foreign or unknown target, the catalogue while it is off, a section whose module is off, two targets, and non-pages on form / booking links', async () => {
    const tmz = ctx({ ...editor(), enabledModuleIds: ['digital-cards', 'catalogue', 'blog', 'reservations'] })
    const refused = (links: unknown[], c = tmz) => expect(save({ links }, fake(), c)).rejects.toMatchObject({ code: 'invalid_value' })
    // another project's catalogue page (not found under this projectSlug)
    await refused([{ key: 'a', kind: 'page', page: 'other-catalogue-page' }])
    // the Catalogue switched off: only pages may be referenced
    await refused([{ key: 'a', kind: 'page', page: 'tmz-catalogue-page' }], ctx(editor()))
    await refused([{ key: 'a', kind: 'page', moduleId: 'catalogue' }], ctx(editor()))
    // sections need their module; unknown sections / modules are refused
    await refused([{ key: 'a', kind: 'page', internalPage: 'events' }])
    await refused([{ key: 'a', kind: 'page', internalPage: 'shop' }])
    await refused([{ key: 'a', kind: 'page', moduleId: 'people' }])
    // one target only
    await refused([{ key: 'a', kind: 'page', page: 'page-1', internalPage: 'blog' }])
    await refused([{ key: 'a', kind: 'page', internalPage: 'blog', moduleId: 'catalogue' }])
    // form / booking point at a page
    await refused([{ key: 'a', kind: 'form', page: 'tmz-catalogue-page' }])
    await refused([{ key: 'a', kind: 'booking', internalPage: 'homepage' }])
    await expect(save({ links: [{ key: 'a', kind: 'form', page: 'page-1' }] }, fake(), tmz)).resolves.toEqual({ rev: 'd2' })
  })

  it('refuses a stale revision, a missing draft and an archived card', async () => {
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old', set: { 'show.phone': true } }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: SITE, rev: 's1', set: { 'show.phone': true } }, fake().deps)).rejects.toMatchObject({ code: 'not_found' })
    const archived = baseDocs()
    archived[CARD] = { ...archived[CARD], archivedAt: '2026-10-10T00:00:00Z' }
    await expect(save({ 'show.phone': true }, fake({ docs: archived }))).rejects.toMatchObject({ code: 'archived' })
  })

  it('the description holds up to 600 characters per language (the server count: trimmed, UTF-16 units)', async () => {
    const f = fake()
    const long = 'x'.repeat(600)
    await expect(save({ 'description.it': `  ${long}\r\n` }, f)).resolves.toEqual({ rev: 'd2' })
    expect((f.patchOps.find((o) => o[0] === 'set')![1] as Record<string, unknown>)['description.it']).toBe(long)
    await expect(save({ 'description.it': 'x'.repeat(601) })).rejects.toMatchObject({ code: 'invalid_value', detail: { field: 'description' } })
    // An emoji counts as its UTF-16 units, like the editor's counter.
    await expect(save({ 'description.it': '🧘‍♀️'.repeat(121) })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('stores a link’s one-line description per language, ≤ 120, site languages only', async () => {
    const f = fake()
    await save({ links: [{ key: 'a', kind: 'url', url: 'https://cyce.info/', label: { it: 'Orari' }, description: { it: '  Orari   e prezzi ', en: '' } }] }, f)
    const set = f.patchOps.find((o) => o[0] === 'set')![1] as { links: any[] }
    expect(set.links[0]).toMatchObject({ label: { _type: 'localizedString', it: 'Orari' }, description: { _type: 'localizedString', it: 'Orari e prezzi' } })
    const g = fake()
    await save({ links: [{ key: 'a', kind: 'url', description: { it: '' } }] }, g)
    expect((g.patchOps.find((o) => o[0] === 'set')![1] as { links: any[] }).links[0]).not.toHaveProperty('description')
    await expect(save({ links: [{ key: 'a', kind: 'url', description: { it: 'x'.repeat(121) } }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url', description: { fr: 'x' } }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(save({ links: [{ key: 'a', kind: 'url', description: 'x' }] })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('a stale revision whose values the draft ALREADY holds (a resent save) answers with the current revision and writes nothing', async () => {
    const docs = baseDocs()
    docs[`drafts.${CARD}`] = { ...docs[`drafts.${CARD}`], description: { _type: 'localizedText', it: 'Ciao' }, show: { phone: true } }
    const f = fake({ docs })
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old', set: { 'description.it': ' Ciao ', 'show.phone': true } }, f.deps)).resolves.toEqual({ rev: 'd1' })
    expect(f.writes).toEqual([])
    // Anything different is still a conflict.
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old', set: { 'description.it': 'Ciao!' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old', set: { 'description.en': '' } }, f.deps)).resolves.toEqual({ rev: 'd1' })
    await expect(saveDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old', set: { 'description.it': '' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(f.writes).toEqual([])
  })

  it('a 409 from Sanity is a conflict', async () => {
    await expect(save({ 'show.phone': true }, fake({ commitError: { statusCode: 409 } }))).rejects.toMatchObject({ code: 'conflict' })
  })
})

// ── Publish ───────────────────────────────────────────────────────────────────

describe('publishDigitalCardDraft', () => {
  it('publishes in one guarded transaction and retires the name that was live (D5)', async () => {
    const f = fake()
    await publishDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'd1' }, f.deps)
    expect(f.txOps[0]).toEqual(['patch', [`drafts.${CARD}`, { ifRevisionID: 'd1', unset: ['_publishGuard'] }]])
    expect(f.txOps[1]).toEqual(['patch', [CARD, { ifRevisionID: 'p1', unset: ['_publishGuard'] }]])
    const doc = f.txOps.find((o) => o[0] === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc).toMatchObject({ _id: CARD, _type: 'digitalCard', projectSlug: 'cyce', urlName: 'anna', retiredUrlNames: ['anna-rossi'], publicId: PUBLIC_ID })
    expect(doc).not.toHaveProperty('_rev')
    expect(f.txOps.at(-1)).toEqual(['delete', `drafts.${CARD}`])
  })

  it('renaming back to a retired name of its own takes it off the retired list', async () => {
    const docs = baseDocs()
    docs[CARD] = { ...docs[CARD], urlName: 'anna-r', retiredUrlNames: ['anna'] }
    const f = fake({ docs })
    await publishDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'd1' }, f.deps)
    expect((f.txOps.find((o) => o[0] === 'createOrReplace')![1] as any).retiredUrlNames).toEqual(['anna-r'])
  })

  it('is blocked, naming what is missing: person offline, no URL name, unfinished links', async () => {
    const docs = baseDocs()
    docs[`drafts.${CARD}`] = {
      ...docs[`drafts.${CARD}`],
      person: { _ref: 'person-off' },
      urlName: '',
      links: [
        { _key: 'a', kind: 'url', hidden: false },
        { _key: 'b', kind: 'url', url: 'https://x.it', hidden: true },
      ],
    }
    const f = fake({ docs })
    await expect(publishDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'd1' }, f.deps)).rejects.toMatchObject({ code: 'publish_blocked', detail: { missing: ['person', 'urlName', 'links'] } })
    expect(f.txOps).toEqual([])
  })

  it('publishBlockers: a site card needs nothing; two shown primaries block', () => {
    expect(publishBlockers({ kind: 'site', links: [] }, true)).toEqual([])
    expect(
      publishBlockers(
        {
          kind: 'site',
          links: [
            { _key: 'a', kind: 'phone', value: '+39 333 1234567', primary: true },
            { _key: 'b', kind: 'email', value: 'a@b.it', primary: true },
          ],
        },
        true
      )
    ).toEqual(['primary'])
  })

  it('refuses a stale revision and an archived card', async () => {
    await expect(publishDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'old' }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    const archived = baseDocs()
    archived[CARD] = { ...archived[CARD], archivedAt: '2026-10-10T00:00:00Z' }
    await expect(publishDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'd1' }, fake({ docs: archived }).deps)).rejects.toMatchObject({ code: 'archived' })
  })
})

// ── Open / discard / lifecycle ────────────────────────────────────────────────

describe('open, discard and the lifecycle', () => {
  it('opening an existing draft creates nothing; a published card gets an exact copy without lifecycle fields', async () => {
    const f = fake()
    expect(await openDigitalCardForEdit(ctx(editor()), PROJECT, { id: CARD }, f.deps)).toEqual({ id: CARD, rev: 'd1', created: false })
    const g = fake()
    const r = await openDigitalCardForEdit(ctx(editor()), PROJECT, { id: SITE }, g.deps)
    expect(r).toMatchObject({ id: SITE, created: true })
    expect(g.created[0]).toMatchObject({ _id: `drafts.${SITE}`, _type: 'digitalCard', projectSlug: 'cyce', kind: 'site' })
    expect(g.created[0]).not.toHaveProperty('_rev')
  })

  it('discard needs a published version', async () => {
    const f = fake()
    await discardDigitalCardDraft(ctx(editor()), PROJECT, { id: CARD, rev: 'd1' }, f.deps)
    expect(f.txOps.at(-1)).toEqual(['delete', `drafts.${CARD}`])
  })

  it('archive marks archivedAt/archivedBy; restore unsets them', async () => {
    const f = fake()
    await archiveDigitalCard(ctx(editor()), PROJECT, { id: CARD }, f.deps)
    const patches = f.txOps.filter((o) => o[0] === 'patch').map((o) => (o[1] as [string, any])[1])
    expect(patches[0].set).toMatchObject({ archivedAt: '2026-11-09T10:00:00.000Z', archivedBy: 'u1' })
    const g = fake({ docs: archivedDocs() })
    await restoreDigitalCard(ctx(editor()), PROJECT, { id: CARD }, g.deps)
    const unset = g.txOps.filter((o) => o[0] === 'patch').map((o) => (o[1] as [string, any])[1].unset)
    expect(unset[0]).toEqual(expect.arrayContaining(['archivedAt', 'archivedBy']))
  })

  it('the owner deletes an archived card permanently; a published one must be archived first', async () => {
    const f = fake({ docs: archivedDocs() })
    await deleteDigitalCardPermanently(ctx(grant()), PROJECT, { id: CARD }, f.deps)
    expect(f.txOps).toContainEqual(['delete', CARD])
    await expect(deleteDigitalCardPermanently(ctx(grant()), PROJECT, { id: CARD }, fake().deps)).rejects.toMatchObject({ code: 'archive_first' })
  })

  it('an unknown action is refused', async () => {
    await expect(runDigitalCardLifecycle(ctx(editor()), PROJECT, { id: CARD, op: 'explode' as never }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

// ── URL name check & statistics ───────────────────────────────────────────────

describe('URL name check and statistics', () => {
  it('checks a name live, with a free suggestion', async () => {
    const f = fake()
    expect(await checkDigitalCardUrlName(ctx(editor()), PROJECT, { id: CARD, urlName: 'mario' }, f.deps)).toEqual({ valid: true, available: false, suggestion: 'mario-2' })
    expect(await checkDigitalCardUrlName(ctx(editor()), PROJECT, { id: CARD, urlName: 'anna-rossi' }, f.deps)).toMatchObject({ valid: true, available: true })
    expect(await checkDigitalCardUrlName(ctx(editor()), PROJECT, { id: CARD, urlName: 'Bad Name' }, f.deps)).toMatchObject({ valid: false, available: false })
    await expect(checkDigitalCardUrlName(ctx(editor()), PROJECT, { id: SITE, urlName: 'x' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('reads the card statistics with the grant project slug, the card publicId and the range', async () => {
    const f = fake()
    const r = await getDigitalCardStats(ctx(editor()), PROJECT, { id: CARD, days: 7 }, f.deps)
    expect(r).toMatchObject({ available: true })
    expect(f.readStats).toHaveBeenCalledWith({ projectSlug: 'cyce', cardId: PUBLIC_ID, from: '2026-11-03', to: '2026-11-09' })
  })

  it('refuses an unknown range; no publicId → not available', async () => {
    const f = fake()
    await expect(getDigitalCardStats(ctx(editor()), PROJECT, { id: CARD, days: 14 }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(await getDigitalCardStats(ctx(editor()), PROJECT, { id: 'retired', days: 7 }, f.deps)).toEqual({ available: false })
    expect(f.readStats).not.toHaveBeenCalled()
  })

  it('a store failure is an opaque error', async () => {
    const f = fake()
    f.readStats.mockRejectedValueOnce(new Error('db down'))
    await expect(getDigitalCardStats(ctx(editor()), PROJECT, { id: CARD, days: 30 }, f.deps)).rejects.toBeInstanceOf(DigitalCardError)
  })
})

// ── Analytics overview (Amendment A) ──────────────────────────────────────────

describe('all cards together (Analytics page)', () => {
  it('needs digital-cards.stats.read before any read', async () => {
    const f = fake()
    await expect(getDigitalCardsOverview(ctx(viewer()), PROJECT, { days: 30 }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.readStats).not.toHaveBeenCalled()
    await expect(getDigitalCardsOverview(ctx(grant()), PROJECT, { days: 12 }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('reads every card of the GRANT’s project and names them; unknown card ids are left out', async () => {
    const f = fake()
    f.readStats.mockResolvedValueOnce({
      available: true,
      stats: {
        totals: { visits: 12, clicks: 4 },
        cards: [
          { cardId: PUBLIC_ID, visits: 9, clicks: 3 },
          { cardId: '33333333-3333-4333-8333-333333333333', visits: 2, clicks: 1 },
          { cardId: '99999999-9999-4999-8999-999999999999', visits: 1, clicks: 0 },
        ],
        links: [],
        sources: [{ source: 'qr', visits: 8, clicks: 2 }],
        days: [],
      },
    } as never)
    const r = await getDigitalCardsOverview(ctx(editor()), PROJECT, { days: 30 }, f.deps)
    expect(f.readStats).toHaveBeenCalledWith({ projectSlug: 'cyce', cardId: null, from: expect.any(String), to: expect.any(String) })
    expect(r).toEqual({
      available: true,
      days: 30,
      siteName: 'CYCE',
      totals: { visits: 12, clicks: 4 },
      cards: [
        { id: CARD, kind: 'person', name: 'Anna Rossi', visits: 9, clicks: 3 },
        { id: SITE, kind: 'site', name: '', visits: 2, clicks: 1 },
      ],
      sources: [{ source: 'qr', visits: 8, clicks: 2 }],
    })
  })

  it('before migration 068: not available', async () => {
    const f = fake()
    f.readStats.mockResolvedValueOnce({ available: false } as never)
    expect(await getDigitalCardsOverview(ctx(grant()), PROJECT, { days: 7 }, f.deps)).toEqual({ available: false })
  })
})
