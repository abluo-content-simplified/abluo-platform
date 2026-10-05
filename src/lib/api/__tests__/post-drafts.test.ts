/**
 * S2b — the dashboard's only Sanity write path. Proves every refusal happens
 * BEFORE anything is written, and that identity always comes from the grant.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { createPostDraft, patchPostDraft, PostDraftError, sanitizeBlocks, LIMITS } from '../post-drafts'
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
    ['image block', { 'body.it': [{ _type: 'image', _key: 'a' }] }],
  ])('refuses %s, nothing written', async (_l, set) => {
    const c = fakeClient()
    await expect(patch(set, c)).rejects.toMatchObject({ code: 'invalid_value' })
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
