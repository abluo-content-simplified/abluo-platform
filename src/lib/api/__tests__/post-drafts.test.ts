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
    fetch: vi.fn(async (q: string, p?: Record<string, unknown>) =>
      // The single-Sanity-project write guard (sanity-project-guard.ts) asks for a count.
      q.startsWith('count(')
        ? 1
        : q.includes('_type == "gallery"')
          ? // Galleries of this project: 'g-live' is published, 'g-new' only exists as a draft.
            {
              published: p?.projectSlug === 'hoffmann' && p?.id === 'g-live' ? 'g-live' : null,
              draft: p?.projectSlug === 'hoffmann' && p?.id === 'g-new' ? 'drafts.g-new' : null,
            }
        : q.includes('"callToAction"')
          ? // Only this project's callToAction 'cta-call' exists.
            p?.id === 'cta-call' && p?.projectSlug === 'hoffmann'
            ? 'cta-call'
            : null
          : { locales: ['it', 'de'], categories: ['cura', 'riflessioni'] }
    ),
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

  it("call to action: mode default / none / custom with one of THIS project's callToAction docs (weak ref)", async () => {
    const c = fakeClient()
    await patch({ 'cta.mode': 'custom', 'cta.ref': 'cta-call' }, c)
    expect(c.ops.find(([o]) => o === 'setIfMissing')?.[1]).toEqual({ cta: {} })
    expect(c.ops.find(([o]) => o === 'set')?.[1]).toMatchObject({
      'cta.mode': 'custom',
      'cta.ref': { _type: 'reference', _ref: 'cta-call', _weak: true },
    })
    const lookup = c.client.fetch.mock.calls.find(([q]) => (q as string).includes('"callToAction"')) as unknown as [string, Record<string, unknown>]
    expect(lookup[1]).toEqual({ id: 'cta-call', projectSlug: 'hoffmann' })
    const c2 = fakeClient()
    await patch({ 'cta.mode': 'none', 'cta.ref': null }, c2)
    expect(c2.ops.find(([o]) => o === 'set')?.[1]).toMatchObject({ 'cta.mode': 'none' })
    expect(c2.ops.find(([o]) => o === 'unset')?.[1]).toEqual(['cta.ref'])
  })

  it.each([
    ['an unknown mode', { 'cta.mode': 'always' }],
    ['an unknown callToAction', { 'cta.mode': 'custom', 'cta.ref': 'cta-gone' }],
    ["another project's callToAction", { 'cta.ref': 'cta-livener' }],
    ['a draft id', { 'cta.ref': 'drafts.cta-call' }],
    ['a non-string ref', { 'cta.ref': { _ref: 'cta-call' } }],
  ])('call to action: refuses %s, nothing written', async (_l, set) => {
    const c = fakeClient()
    await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(wrote(c)).toBe(0)
  })

  it("gallery: a published gallery of THIS project → strong ref; a new (draft-only) one → weak ref; null removes it", async () => {
    const c = fakeClient()
    await patch({ gallery: 'g-live' }, c)
    expect(c.ops.find(([o]) => o === 'set')?.[1]).toMatchObject({ gallery: { _type: 'reference', _ref: 'g-live' } })
    const lookup = c.client.fetch.mock.calls.find(([q]) => (q as string).includes('_type == "gallery"')) as unknown as [string, Record<string, unknown>, Record<string, unknown>]
    expect(lookup[1]).toEqual({ id: 'g-live', draftId: 'drafts.g-live', projectSlug: 'hoffmann' })
    expect(lookup[2]).toEqual({ perspective: 'raw' })
    const c2 = fakeClient()
    await patch({ gallery: 'g-new' }, c2)
    expect(c2.ops.find(([o]) => o === 'set')?.[1]).toMatchObject({
      gallery: { _type: 'reference', _ref: 'g-new', _weak: true, _strengthenOnPublish: { type: 'gallery' } },
    })
    const c3 = fakeClient()
    await patch({ gallery: null }, c3)
    expect(c3.ops.find(([o]) => o === 'unset')?.[1]).toEqual(['gallery'])
  })

  it.each([
    ["another project's / unknown gallery", { gallery: 'g-other' }],
    ['a draft id', { gallery: 'drafts.g-live' }],
    ['a non-string', { gallery: { _ref: 'g-live' } }],
  ])('gallery: refuses %s, nothing written', async (_l, set) => {
    const c = fakeClient()
    await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(wrote(c)).toBe(0)
  })

  it('gallery sub-fields and the layout are not editable here', async () => {
    for (const set of [{ 'gallery._ref': 'g-live' }, { galleryLayout: 'grid' }]) {
      const c = fakeClient()
      await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_field' })
    }
  })

  it('call to action: other cta sub-fields (incl. the old key) are refused', async () => {
    for (const set of [{ 'cta.href': 'https://evil' }, { 'cta.key': 'book' }]) {
      const c = fakeClient()
      await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_field' })
    }
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

  it.each(['drafts.abc', 'versions.r.abc', '../abc', 'a/b', '', '-abc', 'x'.repeat(129), 'abc.def'])(
    'an unsafe id %j is refused without a read',
    async (id) => {
      const c = fakeClient()
      await expect(patch({ 'title.it': 'x' }, c, grant(), 'r1', id)).rejects.toMatchObject({ code: 'not_found' })
      expect(c.client.getDocument).not.toHaveBeenCalled()
    }
  )

  it('a readable migrated id (hoffmann-post-…) is a valid post id', async () => {
    const c = fakeClient({ _id: 'drafts.hoffmann-post-abc', _type: 'post', _rev: 'r1', projectSlug: 'hoffmann' })
    await patch({ 'title.it': 'x' }, c, grant(), 'r1', 'hoffmann-post-abc')
    expect(c.client.getDocument).toHaveBeenCalledWith('drafts.hoffmann-post-abc')
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
  // Wave 2 — existing posts: preserved content is checked against the STORED body for that language.
  // Links round 2 — internal links must point at a page / post / news / event of THIS project.
  describe('patchPostDraft — internal links', () => {
    const para = (ref: string, extra: Record<string, unknown> = {}) => ({
      _type: 'block',
      _key: 'p',
      style: 'normal',
      markDefs: [{ _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: ref, _weak: true }, ...extra }],
      children: [{ _type: 'span', _key: 's', text: 'Chi sono', marks: ['l'] }],
    })
    // Answers the target lookup with the ids that exist in THIS project.
    const withTargets = (ids: string[], doc?: Record<string, unknown>) => {
      const c = fakeClient(doc)
      ;(c.client.fetch as unknown as { mockImplementation: (fn: (q: string, params?: unknown) => Promise<unknown>) => void }).mockImplementation(async (q: string, params?: unknown) => {
        if (q.startsWith('count(')) return 1
        if (q.includes('_id in $ids')) {
          const p = params as { ids: string[]; projectSlug: string; types: string[] }
          expect(p.projectSlug).toBe('hoffmann')
          expect(p.types).toEqual(['page', 'post', 'newsArticle', 'event'])
          return p.ids.filter((id) => ids.includes(id))
        }
        return { locales: ['it', 'de'], categories: ['cura'] }
      })
      return c
    }
    const save = (set: Record<string, unknown>, c: ReturnType<typeof fakeClient>) =>
      patchPostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'r1', set }, deps(c))
    const lookups = (c: ReturnType<typeof fakeClient>) => c.client.fetch.mock.calls.filter(([q]) => String(q).includes('_id in $ids')).length

    it('accepts a link to a page of the same project (one lookup for the whole patch), with a new-tab override', async () => {
      const c = withTargets(['hoffmann-page-chi-sono', 'hoffmann-post-x'])
      await save({ 'body.it': [para('hoffmann-page-chi-sono', { blank: true })], 'body.de': [para('hoffmann-post-x')] }, c)
      expect(lookups(c)).toBe(1)
      const set = c.ops.find(([o]) => o === 'set')![1] as Record<string, unknown>
      expect((set['body.it'] as { markDefs: unknown[] }[])[0].markDefs).toEqual([
        { _type: 'link', _key: 'l', internal: { _type: 'reference', _ref: 'hoffmann-page-chi-sono', _weak: true }, blank: true },
      ])
    })

    it('refuses a link to another project’s (or a missing) document, nothing written', async () => {
      const c = withTargets(['hoffmann-page-chi-sono'])
      await expect(save({ 'body.it': [para('livener-page-about')] }, c)).rejects.toMatchObject({ code: 'invalid_value' })
      expect(wrote(c)).toBe(0)
    })

    it('does not re-check a link already stored (a target deleted later never blocks saving)', async () => {
      const stored = { _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann', body: { it: [para('gone-page')] } }
      const c = withTargets([], stored)
      await save({ 'body.it': [para('gone-page')] }, c)
      expect(lookups(c)).toBe(0)
      expect(wrote(c)).toBe(1)
    })
  })

  describe('patchPostDraft wiring (stored body as reference)', () => {
    const image = { _type: 'image', _key: 'img1', asset: { _type: 'reference', _ref: 'image-abc-10x10-jpg' } }
    const text = { _type: 'block', _key: 'p', style: 'h4', markDefs: [], children: [{ _type: 'span', _key: 's', text: 'Ciao', marks: [] }] }
    const stored = () =>
      fakeClient({ _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann', body: { _type: 'localizedPortableText', it: [text, image] } })
    const save = (set: Record<string, unknown>, c: ReturnType<typeof fakeClient>) =>
      patchPostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'r1', set }, deps(c))

    it('keeps an unchanged stored image and h4 while text changes', async () => {
      const c = stored()
      const edited = { ...text, children: [{ _type: 'span', _key: 's', text: 'Ciao a tutti', marks: [] }] }
      await save({ 'body.it': [image, edited] }, c)
      const set = c.ops.find(([o]) => o === 'set')![1] as Record<string, unknown>
      expect(set['body.it']).toEqual([image, edited])
    })

    it('refuses a new image, a modified image, and stored content used in another language', async () => {
      for (const [path, body] of [
        ['body.it', [{ ...image, _key: 'img2' }]],
        ['body.it', [{ ...image, asset: { _type: 'reference', _ref: 'image-evil-1x1-png' } }]],
        ['body.de', [image]],
      ] as const) {
        const c = stored()
        await expect(save({ [path]: body }, c)).rejects.toMatchObject({ code: 'invalid_value' })
        expect(wrote(c)).toBe(0)
      }
    })
  })

  it('accepts safe links and refuses unsafe ones', () => {
    const withHref = (href: string) => [
      { _type: 'block', _key: 'b', markDefs: [{ _type: 'link', _key: 'l', href }], children: [{ _type: 'span', _key: 's', text: 'x', marks: ['l'] }] },
    ]
    for (const ok of ['https://studio.it', 'mailto:a@b.it', 'tel:+39054412', '/contatti']) {
      expect((sanitizeBlocks(withHref(ok))[0] as { markDefs: unknown[] }).markDefs).toEqual([{ _type: 'link', _key: 'l', href: ok }])
    }
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'ftp://x.it']) {
      expect(() => sanitizeBlocks(withHref(bad))).toThrow(PostDraftError)
    }
  })

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

function readClient(
  o: { doc?: Record<string, unknown> | null; published?: Record<string, unknown> | null; fetchResult?: unknown } = {}
) {
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
    getDocument: vi.fn(async (id: string) => (id.startsWith('drafts.') ? doc : o.published) ?? undefined),
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
      mode: 'create',
      live: null,
      cta: null,
      gallery: null,
    })
    expect(c.getDocument).toHaveBeenCalledWith(`drafts.${ID}`)
  })

  it('a draft over a live post is edit mode: overview step, live dates and slugs', async () => {
    const c = readClient({
      published: {
        _id: ID,
        _type: 'post',
        _rev: 'p3',
        projectSlug: 'hoffmann',
        publishedAt: '2025-11-22T18:01:44.181Z',
        slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'ciao' } },
      },
    })
    const d = await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))
    expect(d).toMatchObject({
      mode: 'edit',
      step: 'review',
      furthest: 'review',
      live: { rev: 'p3', publishedAt: '2025-11-22T18:01:44.181Z', expiresAt: null, slugs: { it: 'ciao' } },
    })
  })

  it('returns the chosen gallery id (weak draft refs included)', async () => {
    const base = { _id: `drafts.${ID}`, _type: 'post', _rev: 'r', projectSlug: 'hoffmann' }
    expect((await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(readClient({ doc: { ...base, gallery: { _ref: 'g1', _weak: true } } })))).gallery).toBe('g1')
  })

  it('returns the call-to-action choice; an unknown stored mode reads as default', async () => {
    const base = { _id: `drafts.${ID}`, _type: 'post', _rev: 'r', projectSlug: 'hoffmann' }
    expect((await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(readClient({ doc: { ...base, cta: { mode: 'custom', ref: { _type: 'reference', _ref: 'cta-call', _weak: true } } } })))).cta).toEqual({ mode: 'custom', ref: 'cta-call' })
    expect((await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(readClient({ doc: { ...base, cta: { mode: 'x' } } })))).cta).toEqual({ mode: 'default', ref: null })
  })

  it("a published doc of another project under the same id makes the draft not_found", async () => {
    const c = readClient({ published: { _id: ID, _type: 'post', _rev: 'p', projectSlug: 'livener' } })
    await expect(getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('an unknown stored step resumes at "type"; no cover → null', async () => {
    const c = readClient({ doc: { _id: `drafts.${ID}`, _type: 'post', _rev: 'r', projectSlug: 'hoffmann', wizard: { step: 'nope' } } })
    const d = await getPostDraft(ctx(grant()), 'project-a', ID, rdeps(c))
    expect(d.step).toBe('type')
    expect(d.cta).toBeNull()
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
        liveIds: [ID, 'other'],
        drafts: [
          { _id: `drafts.${ID}`, _rev: 'dr1', projectSlug: 'hoffmann', title: { _type: 'x', it: 'Ciao', de: 'Hallo' }, categories: ['cura'], step: 'title', furthest: 'publish', updatedAt: '2026-10-05T09:00:00Z', featured: true, bodyLangs: [null, 'it', null], subtitle: { it: 'Sottotitolo' }, bodyText: { it: 'Corpo  del testo', en: null } },
          { _id: 'drafts.22222222-2222-4333-8444-555555555555', projectSlug: 'hoffmann', title: { it: '  ' }, step: 'weird', updatedAt: '2026-10-04T09:00:00Z' },
          { _id: 'drafts.33333333-2222-4333-8444-555555555555', projectSlug: 'livener', title: { it: 'Altro' }, step: 'title' },
          { _id: '44444444-2222-4333-8444-555555555555', projectSlug: 'hoffmann', title: { it: 'Pubblicato' }, step: 'title' },
        ],
      },
    })
    const rows = await listPostDrafts(ctx(grant()), 'project-a', rdeps(c))
    expect(rows).toEqual([
      { id: ID, title: 'Hallo', step: 'title', furthest: 'publish', updatedAt: '2026-10-05T09:00:00Z', titles: { it: 'Ciao', de: 'Hallo' }, categoryKeys: ['cura'], coverThumb: null, rev: 'dr1', hasLive: true, featured: true, bodyLanguages: ['it'], coverCard: null, searchText: 'ciao \n hallo \n sottotitolo \n corpo del testo', subtitle: 'Sottotitolo' },
      { id: '22222222-2222-4333-8444-555555555555', title: null, step: 'type', furthest: 'type', updatedAt: '2026-10-04T09:00:00Z', titles: { it: '  ' }, categoryKeys: [], coverThumb: null, rev: '', hasLive: false, featured: false, bodyLanguages: [], coverCard: null, searchText: '', subtitle: null },
    ])
    // Search covers the body's plain text in every language (pt::text per language).
    expect(c.fetch.mock.calls[0][0]).toContain('pt::text(body.it)')
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
      galleries: [],
      ctas: [],
    })
    expect((c.fetch.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toEqual({ projectSlug: 'hoffmann' })
  })

  it("lists the site's prepared calls to action, texts in the main language", async () => {
    const c = readClient({
      fetchResult: {
        site: { defaultLocale: 'it', supportedLocales: ['it', 'de'] },
        ctas: [
          { _id: 'cta-book', internalName: 'Book a first session', isDefault: true, heading: { it: 'Prenota', de: 'Buchen' }, buttonLabel: { it: 'Scrivimi' } },
          { _id: 'cta-call', heading: { de: 'Anrufen' } },
          { internalName: 'no id — ignored' },
        ],
      },
    })
    const site = await getPostEditorSite(ctx(grant()), 'project-a', { locale: 'en' }, rdeps(c))
    expect(site.ctas).toEqual([
      { id: 'cta-book', name: 'Book a first session', isDefault: true, heading: 'Prenota', buttonLabel: 'Scrivimi' },
      { id: 'cta-call', name: 'cta-call', isDefault: false, heading: null, buttonLabel: null },
    ])
  })

  it("lists this project's galleries once each (draft wins), raw perspective", async () => {
    const c = readClient()
    c.fetch.mockImplementation((async (q: string) =>
      q.includes('_type == "gallery"')
        ? [
            { _id: 'drafts.g1', title: { it: 'Lo studio (bozza)' }, count: 4 },
            { _id: 'g1', title: { it: 'Lo studio' }, count: 3 },
            { _id: 'g2', internalName: 'Team', count: 0 },
            { _id: 'versions.x.g3' },
          ]
        : { site: { defaultLocale: 'it', supportedLocales: ['it'] } }) as never)
    const site = await getPostEditorSite(ctx(grant()), 'project-a', { locale: 'en' }, rdeps(c))
    expect(site.galleries).toEqual([
      { id: 'g1', title: 'Lo studio (bozza)', count: 4 },
      { id: 'g2', title: 'Team', count: 0 },
    ])
    const call = c.fetch.mock.calls.find(([q]) => (q as string).includes('_type == "gallery"')) as unknown as [string, Record<string, unknown>, Record<string, unknown>]
    expect(call[1]).toEqual({ projectSlug: 'hoffmann' })
    expect(call[2]).toEqual({ perspective: 'raw' })
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

// ── Launch hardening: published-doc re-check and single-project guard ────────

describe('patchPostDraft / createPostDraft — isolation hardening', () => {
  const titleSet = { 'title.it': 'Ciao' }

  it("a published doc of another project under the draft's id → not_found, nothing written", async () => {
    const c = fakeClient()
    c.client.getDocument.mockImplementation((async (id: string) =>
      id.startsWith('drafts.')
        ? { _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann' }
        : { _id: ID, _type: 'post', _rev: 'p1', projectSlug: 'other' }) as never)
    await expect(
      patchPostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'r1', set: titleSet }, deps(c))
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(wrote(c)).toBe(0)
  })

  it('a published non-post under the id → not_found', async () => {
    const c = fakeClient()
    c.client.getDocument.mockImplementation((async (id: string) =>
      id.startsWith('drafts.')
        ? { _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann' }
        : { _id: ID, _type: 'siteConfig', projectSlug: 'hoffmann' }) as never)
    await expect(
      patchPostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'r1', set: titleSet }, deps(c))
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(wrote(c)).toBe(0)
  })

  it('writes are refused (forbidden) unless exactly one Sanity project carries the slug', async () => {
    for (const count of [0, 2]) {
      const c = fakeClient()
      c.client.fetch.mockImplementation((async (q: string) =>
        q.startsWith('count(') ? count : { locales: ['it', 'de'], categories: [] }) as never)
      await expect(createPostDraft(ctx(grant()), 'project-a', deps(c))).rejects.toThrow(TenantAuthorizationError)
      await expect(
        patchPostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'r1', set: titleSet }, deps(c))
      ).rejects.toThrow(TenantAuthorizationError)
      expect(wrote(c)).toBe(0)
      const counted = (c.client.fetch.mock.calls as unknown as Array<[string, Record<string, unknown>]>).find(([q]) =>
        q.startsWith('count(')
      )
      expect(counted?.[1]).toEqual({ projectSlug: 'hoffmann' })
    }
  })
})

describe('createPostDraft — draft cap', () => {
  it('refuses (too_large) once the project holds LIMITS.drafts drafts, before the guard or any write', async () => {
    const c = fakeClient()
    c.client.fetch.mockImplementation((async (q: string) =>
      q.includes('_type == "post"') ? LIMITS.drafts : 1) as never)
    await expect(createPostDraft(ctx(grant()), 'project-a', deps(c))).rejects.toMatchObject({ code: 'too_large' })
    expect(wrote(c)).toBe(0)
  })
})
