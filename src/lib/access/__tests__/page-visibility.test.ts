/**
 * ADR-040 B2.5 — "who can see this page" from the dashboard: what the list
 * shows, and the write that sets `page.access` on the published page and its
 * draft — refusing the home page, pages with public file downloads, other
 * projects' pages, unknown or archived groups, stale revisions and read-only
 * grants.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { AccessError } from '../model'
import type { AccessManagementGrant } from '../management'
import { PageAccessRefused, setPageAccess, toAccessPages } from '../page-visibility'
import { createFakeStore, type FakeStore } from './fake-store'

const A = randomUUID()
const grant = (level: 'read' | 'manage' = 'manage') => Object.freeze({ projectId: A, actorUserId: randomUUID(), level }) as unknown as AccessManagementGrant

type Doc = { _id: string; _rev: string; _type: string; projectSlug: string; pageType?: string; sections?: unknown; access?: unknown }

function fakeSanity(docs: Doc[], opts: { projects?: number; failWith?: number } = {}) {
  const byId = new Map(docs.map((d) => [d._id, { ...d }]))
  const commits: Array<Array<{ id: string; ifRevisionID: string; set: Record<string, unknown> }>> = []
  return {
    byId,
    commits,
    client: {
      getDocument: async (id: string) => byId.get(id),
      fetch: async () => opts.projects ?? 1,
      transaction() {
        const ops: Array<{ id: string; ifRevisionID: string; set: Record<string, unknown> }> = []
        const tx = {
          patch(id: string, p: { ifRevisionID: string; set: Record<string, unknown> }) {
            ops.push({ id, ...p })
            return tx
          },
          async commit() {
            if (opts.failWith) throw Object.assign(new Error('x'), { statusCode: opts.failWith })
            commits.push(ops)
            for (const o of ops) Object.assign(byId.get(o.id)!, o.set)
            return {}
          },
        }
        return tx
      },
    } as never,
  }
}

let store: FakeStore, gLive: string, gArchived: string
beforeEach(async () => {
  store = createFakeStore()
  gLive = await store.createGroup(A, { name: { en: 'Parents' }, description: null }, 'x')
  gArchived = await store.createGroup(A, { name: { en: 'Old' }, description: null }, 'x')
  await store.setGroupArchived(A, gArchived, true, 'x')
})

const page = (over: Partial<Doc> = {}): Doc => ({ _id: 'p1', _rev: 'r1', _type: 'page', projectSlug: 'site-a', pageType: 'landing', sections: [], ...over })
const input = (over: Record<string, unknown> = {}) => ({ pageId: 'p1', visibility: 'restricted', groupIds: [gLive], navigation: 'locked', rev: 'r1', draftRev: null, ...over })

describe('setPageAccess', () => {
  it('writes the rule to the published page, guarded by the revision the screen saw', async () => {
    const s = fakeSanity([page()])
    const value = await setPageAccess(store, grant(), 'site-a', input(), { client: s.client })
    expect(value).toEqual({ visibility: 'restricted', groups: [gLive.toLowerCase()], navigation: 'locked' })
    expect(s.commits).toEqual([[{ id: 'p1', ifRevisionID: 'r1', set: { access: value } }]])
  })

  it('also writes the open draft, so publishing it later cannot undo the change', async () => {
    const s = fakeSanity([page(), page({ _id: 'drafts.p1', _rev: 'd1' })])
    await setPageAccess(store, grant(), 'site-a', input({ draftRev: 'd1' }), { client: s.client })
    expect(s.commits[0].map((o) => [o.id, o.ifRevisionID])).toEqual([['p1', 'r1'], ['drafts.p1', 'd1']])
  })

  it('making a page public clears the groups', async () => {
    const s = fakeSanity([page({ access: { visibility: 'restricted', groups: [gLive] } })])
    expect(await setPageAccess(store, grant(), 'site-a', input({ visibility: 'public' }), { client: s.client })).toEqual({ visibility: 'public' })
  })

  it('another project\'s page, a draft or release id, and an unknown page are "not found" — nothing written', async () => {
    const s = fakeSanity([page({ projectSlug: 'site-b' }), page({ _id: 'p2' }), page({ _id: 'drafts.p2', projectSlug: 'site-b', _rev: 'd' })])
    for (const pageId of ['p1', 'drafts.p1', 'versions.r.p1', 'nope', 'p2', '../x']) {
      await expect(setPageAccess(store, grant(), 'site-a', input({ pageId, draftRev: pageId === 'p2' ? 'd' : null }), { client: s.client })).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(s.commits).toEqual([])
  })

  it('the home page can never be members-only', async () => {
    const s = fakeSanity([page({ pageType: 'home' })])
    await expect(setPageAccess(store, grant(), 'site-a', input(), { client: s.client })).rejects.toMatchObject({ reason: 'home' })
  })

  it('a "Download a file" button — on the page or only in its draft — refuses members-only', async () => {
    const cta = [{ _type: 'heroSection', primaryCta: { actionType: 'fileDownload' } }]
    for (const docs of [[page({ sections: cta })], [page(), page({ _id: 'drafts.p1', _rev: 'd1', sections: cta })]]) {
      const s = fakeSanity(docs)
      const e = await setPageAccess(store, grant(), 'site-a', input({ draftRev: docs.length > 1 ? 'd1' : null }), { client: s.client }).catch((x) => x)
      expect(e).toBeInstanceOf(PageAccessRefused)
      expect(e.reason).toBe('file_download')
      expect(s.commits).toEqual([])
    }
    // making such a page public is fine
    const s = fakeSanity([page({ sections: cta })])
    await expect(setPageAccess(store, grant(), 'site-a', input({ visibility: 'public' }), { client: s.client })).resolves.toEqual({ visibility: 'public' })
  })

  it('needs at least one LIVE group of this project', async () => {
    const s = fakeSanity([page()])
    const other = await store.createGroup(randomUUID(), { name: { en: 'x' }, description: null }, 'x')
    await expect(setPageAccess(store, grant(), 'site-a', input({ groupIds: [] }), { client: s.client })).rejects.toMatchObject({ reason: 'no_groups' })
    await expect(setPageAccess(store, grant(), 'site-a', input({ groupIds: [gArchived] }), { client: s.client })).rejects.toThrow(/unknown_group/)
    await expect(setPageAccess(store, grant(), 'site-a', input({ groupIds: [other] }), { client: s.client })).rejects.toThrow(/unknown_group/)
    await expect(setPageAccess(store, grant(), 'site-a', input({ groupIds: ['teachers'] }), { client: s.client })).rejects.toThrow(AccessError)
    expect(s.commits).toEqual([])
  })

  it('a page changed since the screen loaded it (or a 409 from Sanity) is a conflict', async () => {
    const s = fakeSanity([page({ _rev: 'r2' })])
    await expect(setPageAccess(store, grant(), 'site-a', input(), { client: s.client })).rejects.toMatchObject({ reason: 'conflict' })
    const s2 = fakeSanity([page(), page({ _id: 'drafts.p1', _rev: 'd1' })])
    await expect(setPageAccess(store, grant(), 'site-a', input({ draftRev: null }), { client: s2.client })).rejects.toMatchObject({ reason: 'conflict' })
    const s3 = fakeSanity([page()], { failWith: 409 })
    await expect(setPageAccess(store, grant(), 'site-a', input(), { client: s3.client })).rejects.toMatchObject({ reason: 'conflict' })
  })

  it('a read grant changes nothing; an ambiguous Sanity project refuses the write', async () => {
    const s = fakeSanity([page()])
    await expect(setPageAccess(store, grant('read'), 'site-a', input(), { client: s.client })).rejects.toThrow(AccessError)
    const s2 = fakeSanity([page()], { projects: 2 })
    await expect(setPageAccess(store, grant(), 'site-a', input(), { client: s2.client })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect([...s.commits, ...s2.commits]).toEqual([])
  })

  it('refuses an unknown visibility', async () => {
    const s = fakeSanity([page()])
    await expect(setPageAccess(store, grant(), 'site-a', input({ visibility: 'friends' }), { client: s.client })).rejects.toThrow(AccessError)
  })
})

describe('toAccessPages', () => {
  const row = (id: string, path: string, over: Record<string, unknown> = {}) => ({ _id: id, _rev: 'r', pageType: 'landing', title: { en: id.toUpperCase() }, slug: { en: { current: path } }, ...over })
  it('home first and always public, then by path; nested pages say which page above closes them', () => {
    const pages = toAccessPages(
      [
        row('team', 'about/team'),
        row('about', 'about', { access: { visibility: 'restricted', groups: ['11111111-1111-4111-8111-111111111111'] } }),
        row('home', '', { pageType: 'home' }),
      ],
      { locale: 'en', defaultLocale: 'en' }
    )
    expect(pages.map((p) => p.id)).toEqual(['home', 'about', 'team'])
    expect(pages[0]).toMatchObject({ isHome: true, visibility: 'public' })
    expect(pages[1]).toMatchObject({ visibility: 'restricted', groupIds: ['11111111-1111-4111-8111-111111111111'], navigation: 'hidden' })
    expect(pages[2]).toMatchObject({ visibility: 'public', closedBy: 'ABOUT' })
  })
  it('a malformed rule shows as members-only with no group (closed — as the website treats it)', () => {
    const [p] = toAccessPages([row('x', 'x', { access: { visibility: 'Restricted' } })], { locale: 'en', defaultLocale: 'en' })
    expect(p).toMatchObject({ visibility: 'restricted', groupIds: [] })
  })
  it('flags a "Download a file" button on the page or in its draft, and carries both revisions', () => {
    const cta = [{ cta: { actionType: 'fileDownload' } }]
    const [a, b] = toAccessPages(
      [row('a', 'a', { sections: cta }), row('b', 'b', { draft: { _rev: 'd', sections: cta } })],
      { locale: 'en', defaultLocale: 'en' }
    )
    expect([a.hasFileDownload, b.hasFileDownload]).toEqual([true, true])
    expect([a.draftRev, b.draftRev]).toEqual([null, 'd'])
  })
  it('titles in the dashboard language, falling back to the site language', () => {
    const [p] = toAccessPages([row('x', 'x', { title: { it: 'Chi siamo' } })], { locale: 'en', defaultLocale: 'it' })
    expect(p.title).toBe('Chi siamo')
  })
})
