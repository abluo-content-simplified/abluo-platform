import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { addInternalTag, changeInternalTags, listInternalTagRows, TagError } from '../service'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { grantPermissions, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

type Doc = { _id: string; _type: string; _rev: string; projectSlug: string; tags?: string[]; image?: unknown; scope?: string }

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('amelie'),
  membershipId: 'm1',
  role: 'editor',
  enabledModuleIds: ['gallery'],
  ...o,
  permissions: o.permissions ?? grantPermissions(o.role ?? 'editor', o.enabledModuleIds ?? ['gallery']),
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

/** A tiny in-memory Sanity: answers the service's queries and applies transactions with revision checks. */
function fakeClient(docs: Doc[], opts: { failCommit?: number } = {}) {
  const store = new Map(docs.map((d) => [d._id, { ...d }]))
  const writes: { id: string; patch: Record<string, unknown> }[] = []
  let commits = 0
  const client = {
    store,
    writes,
    fetch: vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
      if (query.includes('_type == "project"')) return params.projectSlug === 'amelie' || params.projectSlug === 'other' ? 1 : 0
      if (query.includes('"internalTagList"')) {
        expect(query).toContain('projectSlug == $projectSlug')
        const d = store.get(params.listId as string)
        return d && d._type === 'internalTagList' && d.projectSlug === params.projectSlug ? { _id: d._id, _rev: d._rev, tags: d.tags } : null
      }
      const type = query.includes('"mediaAsset"') ? 'mediaAsset' : 'gallery'
      expect(query).toContain('projectSlug == $projectSlug')
      return [...store.values()]
        .filter((d) => d._type === type && d.projectSlug === params.projectSlug && (d.tags?.length ?? 0) > 0)
        .filter((d) => (type === 'mediaAsset' ? !d._id.startsWith('drafts.') : true))
        .map((d) => ({ _id: d._id, _rev: d._rev, tags: d.tags }))
    }),
    transaction: () => {
      const ops: { id: string; rev: string; set: Record<string, unknown>; unset?: string[] }[] = []
      const creates: Doc[] = []
      const tx = {
        patch(id: string, p: { ifRevisionID: string; set: Record<string, unknown>; unset?: string[] }) {
          ops.push({ id, rev: p.ifRevisionID, set: p.set, unset: p.unset })
          return tx
        },
        create(d: Doc) {
          creates.push(d)
          return tx
        },
        async commit() {
          commits++
          if (opts.failCommit) throw Object.assign(new Error('x'), { statusCode: opts.failCommit })
          for (const o of ops) if (store.get(o.id)?._rev !== o.rev) throw Object.assign(new Error('rev'), { statusCode: 409 })
          for (const d of creates) if (store.has(d._id)) throw Object.assign(new Error('exists'), { statusCode: 409 })
          for (const d of creates) {
            store.set(d._id, { ...d, _rev: 'n1' })
            writes.push({ id: d._id, patch: { create: true } })
          }
          for (const o of ops) {
            const d = store.get(o.id)!
            Object.assign(d, o.set)
            if (o.unset?.includes('tags')) delete d.tags
            d._rev = d._rev + '+'
            writes.push({ id: o.id, patch: o.set })
          }
        },
      }
      return tx
    },
    commits: () => commits,
  }
  return client
}

const photo = (id: string, tags: string[], projectSlug = 'amelie'): Doc => ({ _id: id, _type: 'mediaAsset', _rev: 'r1', projectSlug, tags, image: {} })
const gallery = (id: string, tags: string[], projectSlug = 'amelie'): Doc => ({ _id: id, _type: 'gallery', _rev: 'r1', projectSlug, tags })

describe('listInternalTagRows', () => {
  it('lists only this project’s photos, with whether the person may change them', async () => {
    const c = fakeClient([photo('a', ['sea']), photo('b', ['x'], 'other')])
    const r = await listInternalTagRows(ctx(grant()), 'project-a', 'media', { client: c as never })
    expect(r.rows).toEqual([{ id: 'a', tags: ['sea'] }])
    expect(r.canWrite).toBe(true)
  })
  it('galleries: a draft wins over the published version; counted once; viewers read only', async () => {
    const c = fakeClient([gallery('g1', ['old']), gallery('drafts.g1', ['new']), gallery('g2', ['old'])])
    const r = await listInternalTagRows(ctx(grant({ role: 'viewer' })), 'project-a', 'galleries', { client: c as never })
    expect(r.rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'g1', tags: ['new'] },
      { id: 'g2', tags: ['old'] },
    ])
    expect(r.canWrite).toBe(false)
  })
})

describe('changeInternalTags — media', () => {
  it('renames on every photo in one transaction, with the revision guard', async () => {
    const c = fakeClient([photo('a', ['sea', 'sun']), photo('b', ['sea']), photo('c', ['sun'])])
    const r = await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'merge', from: ['sea'], to: 'ocean' }, { client: c as never })
    expect(r).toEqual({ changed: 2 })
    expect(c.commits()).toBe(1)
    expect(c.store.get('a')!.tags).toEqual(['ocean', 'sun'])
    expect(c.store.get('b')!.tags).toEqual(['ocean'])
    expect(c.store.get('c')!.tags).toEqual(['sun'])
  })
  it('merge leaves each photo with the tag once and never over 10', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const c = fakeClient([photo('a', ten), photo('b', ['t1', 't2'])])
    await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'merge', from: ['t0', 't1', 't2'], to: 't2' }, { client: c as never })
    expect(c.store.get('a')!.tags).toHaveLength(8)
    expect(c.store.get('a')!.tags!.filter((t) => t === 't2')).toHaveLength(1)
    expect(c.store.get('b')!.tags).toEqual(['t2'])
  })
  it('delete removes the tag; a photo left without tags loses the field', async () => {
    const c = fakeClient([photo('a', ['x']), photo('b', ['x', 'y'])])
    const r = await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })
    expect(r.changed).toBe(2)
    expect(c.store.get('a')!.tags).toBeUndefined()
    expect(c.store.get('b')!.tags).toEqual(['y'])
  })
  it('a changed-elsewhere photo fails the whole change (nothing half-written)', async () => {
    const c = fakeClient([photo('a', ['x']), photo('b', ['x'])])
    const realFetch = c.fetch
    c.fetch = vi.fn(async (q: string, p?: Record<string, unknown>) => {
      const rows = await realFetch(q, p)
      // Photo b is edited between the read and the write.
      if (Array.isArray(rows)) c.store.get('b')!._rev = 'r2'
      return rows
    })
    await expect(changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })).rejects.toMatchObject({ code: 'conflict' })
    expect(c.store.get('a')!.tags).toEqual(['x'])
  })
  it('nothing to change writes nothing; empty requests are refused', async () => {
    const c = fakeClient([photo('a', ['x'])])
    expect(await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['zzz'] }, { client: c as never })).toEqual({ changed: 0 })
    expect(c.commits()).toBe(0)
    await expect(changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: [] }, { client: c as never })).rejects.toBeInstanceOf(TagError)
  })
  it('stays in the project: another project’s photos are never touched', async () => {
    const c = fakeClient([photo('a', ['x']), photo('z', ['x'], 'other')])
    await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })
    expect(c.store.get('z')!.tags).toEqual(['x'])
    expect(c.writes.map((w) => w.id)).toEqual(['a'])
    expect(c.store.get('a')!.tags).toBeUndefined()
  })
  it('refuses people who may not manage media, and unknown projects, before any I/O', async () => {
    const c = fakeClient([photo('a', ['x'])])
    await expect(changeInternalTags(ctx(grant({ role: 'viewer' })), 'project-a', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(changeInternalTags(ctx(grant()), 'project-b', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(c.fetch).not.toHaveBeenCalled()
  })
})

describe('changeInternalTags — galleries', () => {
  it('patches the published gallery and its draft, each from its own tags', async () => {
    const c = fakeClient([gallery('g1', ['a', 'b']), gallery('drafts.g1', ['a', 'c']), gallery('g2', ['a'])])
    const r = await changeInternalTags(ctx(grant()), 'project-a', 'galleries', { op: 'merge', from: ['a'], to: 'z' }, { client: c as never })
    expect(r.changed).toBe(2)
    expect(c.commits()).toBe(1)
    expect(c.store.get('g1')!.tags).toEqual(['z', 'b'])
    expect(c.store.get('drafts.g1')!.tags).toEqual(['z', 'c'])
    expect(c.store.get('g2')!.tags).toEqual(['z'])
  })
  it('needs the gallery module and write permission', async () => {
    const c = fakeClient([gallery('g1', ['a'])])
    await expect(changeInternalTags(ctx(grant({ role: 'viewer' })), 'project-a', 'galleries', { op: 'delete', tags: ['a'] }, { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(changeInternalTags(ctx(grant({ enabledModuleIds: [] })), 'project-a', 'galleries', { op: 'delete', tags: ['a'] }, { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(listInternalTagRows(ctx(grant({ enabledModuleIds: [] })), 'project-a', 'galleries', { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
  })
  it('the two vocabularies are separate: gallery changes leave photos alone', async () => {
    const c = fakeClient([gallery('g1', ['a']), photo('p1', ['a'])])
    await changeInternalTags(ctx(grant()), 'project-a', 'galleries', { op: 'delete', tags: ['a'] }, { client: c as never })
    expect(c.store.get('p1')!.tags).toEqual(['a'])
  })
})

// ── Added-but-unused tags (internalTagList) ────────────────────────────────────

const LIST = 'internalTagList.amelie.media'
const list = (tags: string[], projectSlug = 'amelie', id = LIST): Doc => ({ _id: id, _type: 'internalTagList', _rev: 'l1', projectSlug, scope: 'media', tags })

describe('addInternalTag', () => {
  it('creates the list on first use; the new tag lists with no item (count 0)', async () => {
    const c = fakeClient([photo('a', ['sea'])])
    const r = await addInternalTag(ctx(grant()), 'project-a', 'media', '  Été  ', { client: c as never })
    // Stored the way every internal tag is (lib/tag-text: lower case).
    expect(r).toEqual({ tag: 'été', listed: ['été'] })
    expect(c.store.get(LIST)).toMatchObject({ _type: 'internalTagList', projectSlug: 'amelie', scope: 'media', tags: ['été'] })
    const l = await listInternalTagRows(ctx(grant()), 'project-a', 'media', { client: c as never })
    expect(l.listed).toEqual(['été'])
    expect(l.rows).toEqual([{ id: 'a', tags: ['sea'] }])
  })
  it('appends to an existing list with its revision', async () => {
    const c = fakeClient([list(['sun'])])
    await addInternalTag(ctx(grant()), 'project-a', 'media', 'moon', { client: c as never })
    expect(c.store.get(LIST)!.tags).toEqual(['sun', 'moon'])
  })
  it('refuses a duplicate of a used or listed tag, ignoring case and accents', async () => {
    const c = fakeClient([photo('a', ['Été']), list(['Café'])])
    for (const name of ['ete', 'ÉTÉ', 'cafe', ' CAFÉ ']) {
      await expect(addInternalTag(ctx(grant()), 'project-a', 'media', name, { client: c as never })).rejects.toMatchObject({ code: 'duplicate' })
    }
    expect(c.commits()).toBe(0)
  })
  it('refuses an empty name, and people who may not change tags, before any I/O', async () => {
    const c = fakeClient([])
    await expect(addInternalTag(ctx(grant()), 'project-a', 'media', '   ', { client: c as never })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(addInternalTag(ctx(grant({ role: 'viewer' })), 'project-a', 'media', 'x', { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(addInternalTag(ctx(grant({ role: 'viewer' })), 'project-a', 'galleries', 'x', { client: c as never })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(c.fetch).not.toHaveBeenCalled()
  })
  it('two first adds at once: the second create conflicts instead of overwriting', async () => {
    const c = fakeClient([])
    const realFetch = c.fetch
    c.fetch = vi.fn(async (q: string, p?: Record<string, unknown>) => {
      const r = await realFetch(q, p)
      // Someone else creates the list between our read and our write.
      if (q.includes('"internalTagList"') && !c.store.has(LIST)) c.store.set(LIST, list(['theirs']))
      return q.includes('"internalTagList"') ? null : r
    })
    await expect(addInternalTag(ctx(grant()), 'project-a', 'media', 'mine', { client: c as never })).rejects.toMatchObject({ code: 'conflict' })
    expect(c.store.get(LIST)!.tags).toEqual(['theirs'])
  })
  it('stays in the project: another project’s list with this id shape is ignored', async () => {
    const c = fakeClient([list(['x'], 'other')])
    const l = await listInternalTagRows(ctx(grant()), 'project-a', 'media', { client: c as never })
    expect(l.listed).toEqual([])
  })
  it('galleries keep their own list', async () => {
    const c = fakeClient([])
    await addInternalTag(ctx(grant()), 'project-a', 'galleries', 'trips', { client: c as never })
    expect(c.store.get('internalTagList.amelie.galleries')!.tags).toEqual(['trips'])
    expect(c.store.has(LIST)).toBe(false)
  })
})

describe('changeInternalTags keeps the added-tags list in step', () => {
  it('rename of an unused tag only touches the list', async () => {
    const c = fakeClient([photo('a', ['sea']), list(['sun'])])
    const r = await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'merge', from: ['sun'], to: 'star' }, { client: c as never })
    expect(r).toEqual({ changed: 0 })
    expect(c.commits()).toBe(1)
    expect(c.store.get(LIST)!.tags).toEqual(['star'])
    expect(c.store.get('a')!.tags).toEqual(['sea'])
  })
  it('merge rewrites photos and the list in ONE transaction, each name once', async () => {
    const c = fakeClient([photo('a', ['sea']), list(['ocean', 'sun'])])
    await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'merge', from: ['sea', 'ocean', 'sun'], to: 'water' }, { client: c as never })
    expect(c.commits()).toBe(1)
    expect(c.store.get('a')!.tags).toEqual(['water'])
    expect(c.store.get(LIST)!.tags).toEqual(['water'])
  })
  it('delete removes the tag from the list too', async () => {
    const c = fakeClient([photo('a', ['x']), list(['x', 'y'])])
    await changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['x', 'y'] }, { client: c as never })
    expect(c.store.get(LIST)!.tags).toEqual([])
    expect(c.store.get('a')!.tags).toBeUndefined()
  })
  it('a list changed elsewhere fails the whole change', async () => {
    const c = fakeClient([photo('a', ['x']), list(['x'])])
    const realFetch = c.fetch
    c.fetch = vi.fn(async (q: string, p?: Record<string, unknown>) => {
      const r = await realFetch(q, p)
      if (q.includes('"internalTagList"')) c.store.get(LIST)!._rev = 'l2'
      return r
    })
    await expect(changeInternalTags(ctx(grant()), 'project-a', 'media', { op: 'delete', tags: ['x'] }, { client: c as never })).rejects.toMatchObject({ code: 'conflict' })
    expect(c.store.get('a')!.tags).toEqual(['x'])
  })
})
