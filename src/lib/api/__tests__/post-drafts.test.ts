/**
 * S2b — the dashboard's only Sanity write path. Proves every refusal happens
 * BEFORE anything is written, and that identity always comes from the grant.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  createPostDraft,
  patchPostDraft,
  getPostDraft,
  listPostDrafts,
  getPostEditorSite,
  PostDraftError,
  sanitizeBlocks,
  LIMITS,
} from '../post-drafts'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ID = '11111111-2222-4333-8444-555555555555'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
  ...o,
})
const ctx = (...grants: ProjectGrant[]): TenantAuthorizationContext => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: grants,
})

function fakeClient(doc: Record<string, unknown> | null = { _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann' }) {
  const ops: Array<[string, unknown]> = []
  const patch = {
    ifRevisionId: (r: string) => (ops.push(['ifRevisionId', r]), patch),
    setIfMissing: (v: unknown) => (ops.push(['setIfMissing', v]), patch),
    set: (v: unknown) => (ops.push(['set', v]), patch),
    unset: (v: unknown) => (ops.push(['unset', v]), patch),
    commit: vi.fn(async () => (ops.push(['commit', null]), { _rev: 'r2' })),
  }
  const client = {
    create: vi.fn(async (d: Record<string, unknown>) => ({ ...d, _rev: 'r0' })),
    getDocument: vi.fn(async () => doc),
    fetch: vi.fn(async () => ({ locales: ['it', 'de'], categories: ['cura', 'riflessioni'] })),
    patch: vi.fn(() => patch),
  }
  return { client, ops, patch }
}
const deps = (c: ReturnType<typeof fakeClient>) => ({
  client: c.client as never,
  now: () => new Date('2026-10-05T10:00:00Z'),
  uuid: () => ID,
})
const wrote = (c: ReturnType<typeof fakeClient>) => c.client.create.mock.calls.length + c.ops.filter(([o]) => o === 'commit').length

describe('createPostDraft', () => {
  it('creates drafts.<uuid> with _type and projectSlug from the grant', async () => {
    const c = fakeClient()
    const r = await createPostDraft(ctx(grant()), 'project-a', deps(c))
    expect(r).toEqual({ id: ID, rev: 'r0' })
    expect(c.client.create).toHaveBeenCalledWith({
      _id: `drafts.${ID}`,
      _type: 'post',
      projectSlug: 'hoffmann',
      wizard: { step: 'type', updatedAt: '2026-10-05T10:00:00.000Z' },
    })
  })

  it.each([
    ['viewer (no write permission)', grant({ role: 'viewer', permissions: ['blog.post.read'] })],
    ['blog not installed', grant({ enabledModuleIds: ['forms'] })],
  ])('refuses %s before writing', async (_label, g) => {
    const c = fakeClient()
    await expect(createPostDraft(ctx(g), 'project-a', deps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(wrote(c)).toBe(0)
  })

  it("refuses another tenant's project", async () => {
    const c = fakeClient()
    await expect(createPostDraft(ctx(grant()), 'project-b', deps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(wrote(c)).toBe(0)
  })
})

describe('patchPostDraft', () => {
  const patch = (set: Record<string, unknown>, c = fakeClient(), g = grant(), rev = 'r1', id = ID) =>
    patchPostDraft(ctx(g), 'project-a', { id, rev, set }, deps(c))

  it('saves allowed fields with ifRevisionId and returns the new revision', async () => {
    const c = fakeClient()
    const r = await patch({ 'title.it': 'Ciao', 'subtitle.de': '', categories: ['cura'], 'wizard.step': 'title' }, c)
    expect(r).toEqual({ rev: 'r2' })
    expect(c.client.patch).toHaveBeenCalledWith(`drafts.${ID}`)
    expect(c.ops).toEqual([
      ['ifRevisionId', 'r1'],
      ['setIfMissing', { title: { _type: 'localizedString' }, subtitle: { _type: 'localizedString' } }],
      ['set', { 'title.it': 'Ciao', categories: ['cura'], 'wizard.step': 'title', 'wizard.updatedAt': '2026-10-05T10:00:00.000Z' }],
      ['unset', ['subtitle.de']],
      ['commit', null],
    ])
    // Site config is read with the GRANT's projectSlug.
    expect((c.client.fetch.mock.calls[0] as unknown[])[1]).toEqual({ projectSlug: 'hoffmann' })
  })

  it.each([
    ['projectSlug', 'other'],
    ['_type', 'page'],
    ['_id', 'x'],
    ['slug.it', 'x'],
    ['author', { _ref: 'x' }],
    ['publishedAt', '2026-01-01'],
    ['expiresAt', '2026-01-01'],
    ['coverImage', {}],
    ['title', { it: 'whole object' }],
    ['title.en', 'not a site language'],
    ['title.it.extra', 'x'],
    ['wizard', { step: 'type' }],
  ])('refuses forbidden field %s, nothing written', async (path, value) => {
    const c = fakeClient()
    await expect(patch({ [path]: value }, c)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(wrote(c)).toBe(0)
  })

  it.each([
    ['unknown category', { categories: ['not-configured'] }],
    ['too many categories', { categories: Array(LIMITS.categories + 1).fill('cura') }],
    ['title too long', { 'title.it': 'x'.repeat(LIMITS.title + 1) }],
    ['title not text', { 'title.it': 42 }],
    ['unknown wizard step', { 'wizard.step': 'hack' }],
    ['unknown furthest step', { 'wizard.furthest': 'everywhere' }],
    ['furthest not a string', { 'wizard.furthest': { $set: 'x' } }],
    ['image block', { 'body.it': [{ _type: 'image', _key: 'a' }] }],
  ])('refuses %s, nothing written', async (_l, set) => {
    const c = fakeClient()
    await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(wrote(c)).toBe(0)
  })

  it('accepts the overview step and the furthest step (same enum as wizard.step)', async () => {
    const c = fakeClient()
    await patch({ 'wizard.step': 'review', 'wizard.furthest': 'publish' }, c)
    expect(c.ops.find(([o]) => o === 'set')?.[1]).toEqual({
      'wizard.step': 'review',
      'wizard.furthest': 'publish',
      'wizard.updatedAt': '2026-10-05T10:00:00.000Z',
    })
  })

  it('refuses other wizard sub-fields', async () => {
    const c = fakeClient()
    await expect(patch({ 'wizard.updatedAt': '2020-01-01' }, c)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(wrote(c)).toBe(0)
  })

  it('refuses an oversized patch before reading anything', async () => {
    const c = fakeClient()
    await expect(patch({ 'title.it': 'x'.repeat(LIMITS.patchBytes) }, c)).rejects.toMatchObject({ code: 'too_large' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it("another project's draft looks like a missing one", async () => {
    const c = fakeClient({ _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'livener' })
    await expect(patch({ 'title.it': 'x' }, c)).rejects.toMatchObject({ code: 'not_found' })
    expect(wrote(c)).toBe(0)
    const missing = fakeClient(null)
    await expect(patch({ 'title.it': 'x' }, missing)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a non-post document with the same id is refused', async () => {
    const c = fakeClient({ _id: `drafts.${ID}`, _type: 'page', _rev: 'r1', projectSlug: 'hoffmann' })
    await expect(patch({ 'title.it': 'x' }, c)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a malformed id (e.g. a published id) is refused without a read', async () => {
    const c = fakeClient()
    await expect(patch({ 'title.it': 'x' }, c, grant(), 'r1', 'hoffmann-post-abc')).rejects.toMatchObject({ code: 'not_found' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it('stale revision → conflict, nothing written', async () => {
    const c = fakeClient()
    await expect(patch({ 'title.it': 'x' }, c, grant(), 'r0')).rejects.toMatchObject({ code: 'conflict' })
    expect(wrote(c)).toBe(0)
  })

  it('a race caught by Sanity (409) → conflict', async () => {
    const c = fakeClient()
    c.patch.commit.mockRejectedValueOnce(Object.assign(new Error('rev mismatch'), { statusCode: 409 }))
    await expect(patch({ 'title.it': 'x' }, c)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('viewer cannot patch', async () => {
    const c = fakeClient()
    await expect(patch({ 'title.it': 'x' }, c, grant({ role: 'viewer', permissions: ['blog.post.read'] }))).rejects.toThrow(
      TenantAuthorizationError
    )
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })
})

describe('sanitizeBlocks', () => {
  it('keeps text blocks, drops unknown keys', () => {
    const out = sanitizeBlocks([
      {
        _type: 'block',
        _key: 'b1',
        style: 'h2',
        listItem: 'bullet',
        level: 1,
        evil: '<script>',
        markDefs: [],
        children: [{ _type: 'span', _key: 's1', text: 'Hi', marks: ['strong', 'strong'], extra: 1 }],
      },
    ])
    expect(out).toEqual([
      {
        _type: 'block',
        _key: 'b1',
        style: 'h2',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', _key: 's1', text: 'Hi', marks: ['strong'] }],
      },
    ])
  })

  it.each([
    [{ _type: 'block', _key: 'b', style: 'h1', children: [{ _type: 'span', _key: 's', text: '' }] }],
    [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text: '', marks: ['link1'] }] }],
    [{ _type: 'block', _key: 'b', markDefs: [{ _type: 'link', _key: 'l' }], children: [{ _type: 'span', _key: 's', text: '' }] }],
    [{ _type: 'block', _key: 'bad key!', children: [{ _type: 'span', _key: 's', text: '' }] }],
  ])('refuses unsupported content %#', (block) => {
    expect(() => sanitizeBlocks([block])).toThrow(PostDraftError)
  })
})

// ── S2c — wizard reads ───────────────────────────────────────────────────────

function readClient(o: { doc?: Record<string, unknown> | null; fetchResult?: unknown } = {}) {
  const doc =
    o.doc === undefined
      ? {
          _id: `drafts.${ID}`,
          _type: 'post',
          _rev: 'r9',
          projectSlug: 'hoffmann',
          title: { _type: 'localizedString', it: 'Ciao', de: 'Hallo' },
          subtitle: { _type: 'localizedString', it: 'Sotto' },
          body: { _type: 'localizedPortableText', it: [{ _type: 'block', _key: 'b' }] },
          categories: ['cura'],
          coverImage: { _type: 'localizedImage', asset: { _ref: 'image-abc-10x10-jpg' }, alt: { _type: 'x', it: 'Alt' } },
          wizard: { step: 'story', furthest: 'cover', updatedAt: '2026-10-05T09:00:00Z' },
        }
      : o.doc
  return {
    create: vi.fn(),
    patch: vi.fn(),
    getDocument: vi.fn(async () => doc ?? undefined),
    fetch: vi.fn(async (q: string) => (o.fetchResult !== undefined ? o.fetchResult : q.includes('.url') ? 'https://cdn/x.jpg' : null)),
  }
}
const rdeps = (client: ReturnType<typeof readClient>) => ({ client: client as never })

describe('getPostDraft', () => {
  it('returns the snapshot: localized maps without _type, cover url resolved, stored step', async () => {
    const c = readClient()
    const d = await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))
    expect(d).toEqual({
      id: ID,
      rev: 'r9',
      title: { it: 'Ciao', de: 'Hallo' },
      subtitle: { it: 'Sotto' },
      excerpt: {},
      body: { it: [{ _type: 'block', _key: 'b' }] },
      categories: ['cura'],
      cover: { assetId: 'image-abc-10x10-jpg', url: 'https://cdn/x.jpg', alt: { it: 'Alt' } },
      step: 'story',
      furthest: 'cover',
    })
    expect(c.getDocument).toHaveBeenCalledWith(`drafts.${ID}`)
  })

  it('an unknown stored step resumes at "type"; no cover → null', async () => {
    const c = readClient({ doc: { _id: `drafts.${ID}`, _type: 'post', _rev: 'r', projectSlug: 'hoffmann', wizard: { step: 'nope' } } })
    const d = await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))
    expect(d.step).toBe('type')
    expect(d.furthest).toBe('type')
    expect(d.cover).toBeNull()
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it("another project's draft, a missing draft and a non-post all read as not_found", async () => {
    for (const doc of [
      { _id: `drafts.${ID}`, _type: 'post', _rev: 'r', projectSlug: 'livener' },
      null,
      { _id: `drafts.${ID}`, _type: 'page', _rev: 'r', projectSlug: 'hoffmann' },
    ]) {
      const c = readClient({ doc })
      await expect(getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))).rejects.toMatchObject({ code: 'not_found' })
    }
  })

  it('a malformed id is not_found before any read', async () => {
    const c = readClient()
    await expect(getPostDraft(ctx(grant()), 'project-a', `../${ID}`, rdeps(c))).rejects.toMatchObject({ code: 'not_found' })
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['a viewer (read is not enough to edit)', grant({ role: 'viewer', permissions: ['blog.post.read'] }), 'project-a'],
    ['blog not installed', grant({ enabledModuleIds: ['forms'] }), 'project-a'],
    ["another tenant's project", grant(), 'project-b'],
  ])('refuses %s before any read', async (_l, g, projectId) => {
    const c = readClient()
    await expect(getPostDraft(ctx(g), projectId, ID, rdeps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })
})

describe('listPostDrafts', () => {
  it('lists this project\'s wizard drafts (raw perspective, grant slug), title in the default language', async () => {
    const c = readClient({
      fetchResult: {
        defaultLocale: 'de',
        drafts: [
          { _id: `drafts.${ID}`, projectSlug: 'hoffmann', title: { _type: 'x', it: 'Ciao', de: 'Hallo' }, categories: ['cura'], step: 'title', furthest: 'publish', updatedAt: '2026-10-05T09:00:00Z' },
          { _id: 'drafts.22222222-2222-4333-8444-555555555555', projectSlug: 'hoffmann', title: { it: '  ' }, step: 'weird', updatedAt: '2026-10-04T09:00:00Z' },
          { _id: 'drafts.33333333-2222-4333-8444-555555555555', projectSlug: 'livener', title: { it: 'Altro' }, step: 'title' },
          { _id: '44444444-2222-4333-8444-555555555555', projectSlug: 'hoffmann', title: { it: 'Pubblicato' }, step: 'title' },
        ],
      },
    })
    const rows = await listPostDrafts(ctx(grant()), 'project-a', rdeps(c))
    expect(rows).toEqual([
      { id: ID, title: 'Hallo', step: 'title', furthest: 'publish', updatedAt: '2026-10-05T09:00:00Z', titles: { it: 'Ciao', de: 'Hallo' }, categoryKeys: ['cura'], coverThumb: null },
      { id: '22222222-2222-4333-8444-555555555555', title: null, step: 'type', furthest: 'type', updatedAt: '2026-10-04T09:00:00Z', titles: { it: '  ' }, categoryKeys: [], coverThumb: null },
    ])
    const [query, params, options] = c.fetch.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
    expect(params).toEqual({ projectSlug: 'hoffmann' })
    expect(options).toEqual({ perspective: 'raw' })
    expect(query).toContain('_id in path("drafts.**")')
    expect(query).toContain('projectSlug == $projectSlug')
  })

  it.each([
    ['a viewer', grant({ role: 'viewer', permissions: ['blog.post.read'] }), 'project-a'],
    ["another tenant's project", grant(), 'project-b'],
  ])('refuses %s before any read', async (_l, g, projectId) => {
    const c = readClient()
    await expect(listPostDrafts(ctx(g), projectId, rdeps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(c.fetch).not.toHaveBeenCalled()
  })
})

describe('getPostEditorSite', () => {
  it('default language first, category labels in the viewer language, origin from the domain', async () => {
    const c = readClient({
      fetchResult: {
        site: { defaultLocale: 'it', supportedLocales: ['de', 'it'] },
        categories: [{ value: 'cura', label: { it: 'Cura', en: 'Care' } }, { value: 'senza-label' }],
        customDomain: 'ch-psicoterapeuta.com/',
      },
    })
    const site = await getPostEditorSite(ctx(grant()), 'project-a', { locale: 'en' }, rdeps(c))
    expect(site).toEqual({
      projectSlug: 'hoffmann',
      defaultLocale: 'it',
      languages: ['it', 'de'],
      categories: [
        { value: 'cura', label: 'Care' },
        { value: 'senza-label', label: 'senza label' },
      ],
      origin: 'https://ch-psicoterapeuta.com',
    })
    expect((c.fetch.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toEqual({ projectSlug: 'hoffmann' })
  })

  it('no domain → origin null', async () => {
    const c = readClient({ fetchResult: { site: { defaultLocale: 'en', supportedLocales: ['en'] } } })
    const site = await getPostEditorSite(ctx(grant()), 'project-a', { locale: 'en' }, rdeps(c))
    expect(site.origin).toBeNull()
    expect(site.languages).toEqual(['en'])
  })
})

describe('coverThumbUrl', () => {
  it('crops around the focal point on the Sanity CDN only', async () => {
    const { coverThumbUrl } = await import('../post-drafts')
    expect(coverThumbUrl('https://cdn.sanity.io/images/p/d/a.jpg', { x: 0.25, y: 0.8 })).toBe(
      'https://cdn.sanity.io/images/p/d/a.jpg?w=160&h=160&fit=crop&auto=format&crop=focalpoint&fp-x=0.250&fp-y=0.800'
    )
    expect(coverThumbUrl('https://cdn.sanity.io/images/p/d/a.jpg')).toBe('https://cdn.sanity.io/images/p/d/a.jpg?w=160&h=160&fit=crop&auto=format')
    expect(coverThumbUrl('https://evil.example/a.jpg')).toBeNull()
    expect(coverThumbUrl(null)).toBeNull()
  })
})
