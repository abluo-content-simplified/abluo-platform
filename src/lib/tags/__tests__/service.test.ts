import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { changeInternalTags, listInternalTagRows, TagError } from '../service'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { grantPermissions, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

type Doc = { _id: string; _type: string; _rev: string; projectSlug: string; tags?: string[]; image?: unknown }

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
      const type = query.includes('"mediaAsset"') ? 'mediaAsset' : 'gallery'
      expect(query).toContain('projectSlug == $projectSlug')
      return [...store.values()]
        .filter((d) => d._type === type && d.projectSlug === params.projectSlug && (d.tags?.length ?? 0) > 0)
        .filter((d) => (type === 'mediaAsset' ? !d._id.startsWith('drafts.') : true))
        .map((d) => ({ _id: d._id, _rev: d._rev, tags: d.tags }))
    }),
    transaction: () => {
      const ops: { id: string; rev: string; set: Record<string, unknown>; unset?: string[] }[] = []
      const tx = {
        patch(id: string, p: { ifRevisionID: string; set: Record<string, unknown>; unset?: string[] }) {
          ops.push({ id, rev: p.ifRevisionID, set: p.set, unset: p.unset })
          return tx
        },
        async commit() {
          commits++
          if (opts.failCommit) throw Object.assign(new Error('x'), { statusCode: opts.failCommit })
          for (const o of ops) if (store.get(o.id)?._rev !== o.rev) throw Object.assign(new Error('rev'), { statusCode: 409 })
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
