/**
 * S5 — publishing a dashboard draft. Proves the gate and ownership checks run
 * before anything is written, that the published document is built from the
 * draft with identity from the grant, and that the commit is one
 * revision-guarded transaction.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { publishPostDraft, slugFromTitle, uniqueSlug, PostPublishError, type PublishPostInput } from '../post-publish'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ID = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-10-05T10:00:00Z')
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

const body = [{ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's1', text: 'Ciao', marks: [] }] }]
const baseDraft = () => ({
  _id: `drafts.${ID}`,
  _type: 'post',
  _rev: 'r1',
  _createdAt: '2026-10-01T00:00:00Z',
  _updatedAt: '2026-10-04T00:00:00Z',
  projectSlug: 'hoffmann',
  title: { _type: 'localizedString', it: 'Perché la terapia è utile', de: 'Warum Therapie hilft', en: '  ' },
  subtitle: { _type: 'localizedString', it: 'Sottotitolo' },
  body: { _type: 'localizedPortableText', it: body, de: body },
  categories: ['cura'],
  wizard: { step: 'publish', updatedAt: '2026-10-04T00:00:00Z' },
})

type Opts = {
  draft?: Record<string, unknown> | null
  published?: Record<string, unknown> | null
  site?: Record<string, unknown> | null
  others?: Array<{ slug: Record<string, { current: string }> }>
  commitError?: unknown
}
function fakeClient(o: Opts = {}) {
  const draft = o.draft === undefined ? baseDraft() : o.draft
  const published = o.published ?? null
  const ops: Array<[string, ...unknown[]]> = []
  const tx = {
    patch: (id: string, p: unknown) => (ops.push(['patch', id, p]), tx),
    createOrReplace: (d: unknown) => (ops.push(['createOrReplace', d]), tx),
    delete: (id: string) => (ops.push(['delete', id]), tx),
    commit: vi.fn(async () => {
      if (o.commitError) throw o.commitError
      ops.push(['commit'])
      return { results: [] }
    }),
  }
  const client = {
    getDocument: vi.fn(async (id: string) => (id.startsWith('drafts.') ? draft : published) ?? undefined),
    fetch: vi.fn(async (q: string) =>
      q.includes('siteConfig')
        ? o.site === undefined
          ? { defaultLocale: 'it', supportedLocales: ['it', 'de', 'en'] }
          : o.site
        : (o.others ?? [])
    ),
    transaction: vi.fn(() => tx),
  }
  return { client, ops, tx }
}
const deps = (c: ReturnType<typeof fakeClient>) => ({ client: c.client as never, now: () => NOW })
const committed = (c: ReturnType<typeof fakeClient>) => c.ops.some(([o]) => o === 'commit') || c.client.transaction.mock.calls.length > 0
const publish = (c: ReturnType<typeof fakeClient>, input: Partial<PublishPostInput> = {}, g = grant()) =>
  publishPostDraft(ctx(g), 'project-a', { id: ID, rev: 'r1', mode: 'now', ...input }, deps(c))

describe('slug helpers', () => {
  it('lowercases, strips accents, hyphenates, single segment, ≤ 80', () => {
    expect(slugFromTitle('Perché la Terapia è utile?')).toBe('perche-la-terapia-e-utile')
    expect(slugFromTitle('Ansia / stress: che fare')).toBe('ansia-stress-che-fare')
    const long = slugFromTitle('parola '.repeat(40))
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith('-')).toBe(false)
  })
  it('appends -2, -3 … and stays within the limit', () => {
    expect(uniqueSlug('a', new Set())).toBe('a')
    expect(uniqueSlug('a', new Set(['a', 'a-2']))).toBe('a-3')
    const base = 'x'.repeat(80)
    expect(uniqueSlug(base, new Set([base]))).toBe(`${'x'.repeat(78)}-2`)
  })
})

describe('publishPostDraft', () => {
  it('publishes: fields copied, wizard/system fields stripped, slugs per titled language, one transaction', async () => {
    const c = fakeClient()
    const r = await publish(c)
    expect(r).toEqual({
      id: ID,
      publishedAt: '2026-10-05T10:00:00.000Z',
      slugs: { it: 'perche-la-terapia-e-utile', de: 'warum-therapie-hilft' },
    })
    expect(c.ops).toEqual([
      ['patch', `drafts.${ID}`, { ifRevisionID: 'r1', unset: ['_publishGuard'] }],
      [
        'createOrReplace',
        {
          _id: ID,
          _type: 'post',
          projectSlug: 'hoffmann',
          title: baseDraft().title,
          subtitle: baseDraft().subtitle,
          body: baseDraft().body,
          categories: ['cura'],
          slug: {
            _type: 'localizedSlug',
            it: { _type: 'slug', current: 'perche-la-terapia-e-utile' },
            de: { _type: 'slug', current: 'warum-therapie-hilft' },
          },
          publishedAt: '2026-10-05T10:00:00.000Z',
        },
      ],
      ['delete', `drafts.${ID}`],
      ['commit'],
    ])
    // Site config and slug lookups use the GRANT's projectSlug.
    for (const call of c.client.fetch.mock.calls as unknown as Array<[string, Record<string, unknown>]>) {
      expect(call[1].projectSlug).toBe('hoffmann')
    }
  })

  it('identity comes from the grant, not the draft content', async () => {
    const c = fakeClient({ draft: { ...baseDraft(), _type: 'post', publishedAt: '2020-01-01T00:00:00Z', slug: { it: { current: 'x' } } } })
    await publish(c)
    const doc = c.ops.find(([o]) => o === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc.publishedAt).toBe('2026-10-05T10:00:00.000Z')
    expect((doc.slug as Record<string, { current: string }>).it.current).toBe('perche-la-terapia-e-utile')
    expect(doc).not.toHaveProperty('wizard')
    expect(doc).not.toHaveProperty('_rev')
    expect(doc).not.toHaveProperty('_createdAt')
    expect(doc).not.toHaveProperty('_updatedAt')
  })

  it('a slug taken by another post of the same project gets -2', async () => {
    const c = fakeClient({
      others: [
        { slug: { it: { current: 'perche-la-terapia-e-utile' } } },
        { slug: { de: { current: 'perche-la-terapia-e-utile-2' } } },
      ],
    })
    const r = await publish(c)
    expect(r.slugs).toEqual({ it: 'perche-la-terapia-e-utile-2', de: 'warum-therapie-hilft' })
    const [, params] = c.client.fetch.mock.calls[1] as unknown as [string, Record<string, unknown>]
    expect(params).toEqual({ projectSlug: 'hoffmann', id: ID })
  })

  it('an already-published post keeps its slugs; a new language gets one; published rev is guarded', async () => {
    const c = fakeClient({
      published: {
        _id: ID,
        _type: 'post',
        _rev: 'p7',
        projectSlug: 'hoffmann',
        slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'vecchio-slug' } },
      },
    })
    const r = await publish(c)
    expect(r.slugs).toEqual({ it: 'vecchio-slug', de: 'warum-therapie-hilft' })
    expect(c.ops[1]).toEqual(['patch', ID, { ifRevisionID: 'p7', unset: ['_publishGuard'] }])
  })

  it('needs no slug lookup when every language already has a slug', async () => {
    const c = fakeClient({
      published: {
        _id: ID,
        _type: 'post',
        _rev: 'p7',
        projectSlug: 'hoffmann',
        slug: { it: { current: 'a' }, de: { current: 'b' } },
      },
    })
    await publish(c)
    expect(c.client.fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a draft without a title in the default language', async () => {
    const draft = { ...baseDraft(), title: { _type: 'localizedString', de: 'Nur Deutsch', it: '   ' } }
    const c = fakeClient({ draft })
    await expect(publish(c)).rejects.toMatchObject({ code: 'missing_title' })
    expect(committed(c)).toBe(false)
  })

  it('D9: a language with a title but no body text does not go live', async () => {
    const empty = [{ _type: 'block', _key: 'e', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's', text: '   ', marks: [] }] }]
    const draft = { ...baseDraft(), body: { _type: 'localizedPortableText', it: body, de: empty } }
    const c = fakeClient({ draft })
    const r = await publish(c)
    expect(r.slugs).toEqual({ it: 'perche-la-terapia-e-utile' })
    const doc = c.ops.find(([o]) => o === 'createOrReplace')![1] as Record<string, Record<string, unknown>>
    expect(Object.keys(doc.slug)).toEqual(['_type', 'it'])
  })

  it('D9: a language with a body but no title does not go live', async () => {
    const draft = { ...baseDraft(), title: { _type: 'localizedString', it: 'Titolo' }, body: { _type: 'localizedPortableText', it: body, en: body } }
    const r = await publish(fakeClient({ draft }))
    expect(Object.keys(r.slugs)).toEqual(['it'])
  })

  it.each([
    ['no body at all', undefined],
    ['an empty list', []],
    ['only blank text', [{ _type: 'block', _key: 'e', children: [{ _type: 'span', _key: 's', text: ' \n ' }] }]],
  ])('refuses a draft whose default language has %s: missing_body', async (_l, it) => {
    const draft = { ...baseDraft(), body: it === undefined ? undefined : { _type: 'localizedPortableText', it, de: body } }
    const c = fakeClient({ draft })
    await expect(publish(c)).rejects.toMatchObject({ code: 'missing_body' })
    expect(committed(c)).toBe(false)
  })

  it('schedules a future publishedAt with an expiry after it', async () => {
    const c = fakeClient()
    const r = await publish(c, { mode: 'schedule', publishAt: '2026-10-10T08:00:00.000Z', expiresAt: '2026-11-10T08:00:00Z' })
    expect(r.publishedAt).toBe('2026-10-10T08:00:00.000Z')
    const doc = c.ops.find(([o]) => o === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc.expiresAt).toBe('2026-11-10T08:00:00.000Z')
  })

  it.each([
    ['in the past', '2026-10-05T09:59:00Z'],
    ['now', NOW.toISOString()],
    ['more than two years away', '2028-12-01T00:00:00Z'],
    ['not ISO', '10/10/2026'],
    ['missing', undefined],
  ])('refuses a schedule %s before reading anything', async (_l, publishAt) => {
    const c = fakeClient()
    await expect(publish(c, { mode: 'schedule', publishAt })).rejects.toMatchObject({ code: 'invalid_schedule' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
    expect(committed(c)).toBe(false)
  })

  it.each([
    ['before publishedAt', '2026-10-05T09:00:00Z'],
    ['equal to publishedAt', '2026-10-05T10:00:00Z'],
    ['malformed', 'tomorrow'],
  ])('refuses expiresAt %s', async (_l, expiresAt) => {
    const c = fakeClient()
    await expect(publish(c, { expiresAt })).rejects.toMatchObject({ code: 'invalid_expiry' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it('refuses an unknown mode', async () => {
    const c = fakeClient()
    await expect(publish(c, { mode: 'later' as never })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it("another project's draft, a missing draft and a non-post look the same: not_found", async () => {
    for (const draft of [{ ...baseDraft(), projectSlug: 'livener' }, null, { ...baseDraft(), _type: 'page' }]) {
      const c = fakeClient({ draft })
      await expect(publish(c)).rejects.toMatchObject({ code: 'not_found' })
      expect(committed(c)).toBe(false)
    }
  })

  it("a published doc of another project with the same id is refused", async () => {
    const c = fakeClient({ published: { _id: ID, _type: 'post', _rev: 'x', projectSlug: 'livener' } })
    await expect(publish(c)).rejects.toMatchObject({ code: 'not_found' })
    expect(committed(c)).toBe(false)
  })

  it('a malformed id is not_found before any read', async () => {
    const c = fakeClient()
    await expect(publish(c, { id: `../${ID}` })).rejects.toMatchObject({ code: 'not_found' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['viewer (no write permission)', grant({ role: 'viewer', permissions: ['blog.post.read'] })],
    ['blog not installed', grant({ enabledModuleIds: ['forms'] })],
  ])('refuses %s before any read', async (_l, g) => {
    const c = fakeClient()
    await expect(publish(c, {}, g)).rejects.toThrow(TenantAuthorizationError)
    expect(c.client.getDocument).not.toHaveBeenCalled()
    expect(c.client.fetch).not.toHaveBeenCalled()
    expect(committed(c)).toBe(false)
  })

  it("refuses another tenant's project before any read", async () => {
    const c = fakeClient()
    await expect(publishPostDraft(ctx(grant()), 'project-b', { id: ID, rev: 'r1', mode: 'now' }, deps(c))).rejects.toThrow(
      TenantAuthorizationError
    )
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it('a stale rev is a conflict, nothing written', async () => {
    const c = fakeClient()
    await expect(publish(c, { rev: 'r0' })).rejects.toMatchObject({ code: 'conflict' })
    expect(committed(c)).toBe(false)
  })

  it('a concurrent edit (409 from the transaction) is a conflict', async () => {
    const c = fakeClient({ commitError: Object.assign(new Error('rev mismatch'), { statusCode: 409 }) })
    await expect(publish(c)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('any other commit failure is an opaque "failed"', async () => {
    const c = fakeClient({ commitError: new Error('boom: secret detail') })
    const err = await publish(c).catch((e) => e)
    expect(err).toBeInstanceOf(PostPublishError)
    expect(err).toMatchObject({ code: 'failed', message: 'Could not publish.' })
  })
})
