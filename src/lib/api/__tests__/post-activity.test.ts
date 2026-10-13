import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { getPostActivity, publicationWindow } from '../post-activity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const NOW = new Date('2026-10-13T10:00:00Z')
const grant = (permissions = ['blog.post.read']): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('tmz'),
  membershipId: 'm1',
  role: 'viewer',
  permissions,
  enabledModuleIds: ['blog'],
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const client = (docs: Record<string, Record<string, unknown> | undefined>, zone: string | null = 'Europe/Rome') => ({
  getDocument: vi.fn(async (id: string) => docs[id]),
  fetch: vi.fn(async () => zone),
})

describe('getPostActivity', () => {
  it('needs blog.post.read and reads nothing without it', async () => {
    const c = client({})
    const read = vi.fn()
    await expect(getPostActivity(ctx(grant([])), 'project-a', 'p1', { client: c as never, read })).rejects.toThrow()
    expect(c.getDocument).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
  it("another project's post, or none at all, is not_found — and its log is never read", async () => {
    const read = vi.fn()
    for (const docs of [{ p1: { _type: 'post', projectSlug: 'other' } }, {}, { p1: { _type: 'event', projectSlug: 'tmz' } }] as Array<Record<string, Record<string, unknown> | undefined>>) {
      await expect(getPostActivity(ctx(grant()), 'project-a', 'p1', { client: client(docs) as never, read })).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(read).not.toHaveBeenCalled()
  })
  it('returns the items, the site time zone and the window', async () => {
    const read = vi.fn(async () => [])
    const r = await getPostActivity(ctx(grant()), 'project-a', 'p1', {
      client: client({ p1: { _type: 'post', projectSlug: 'tmz', publishedAt: '2026-10-01T09:00:00Z', expiresAt: '2026-10-05T09:00:00Z' } }) as never,
      read,
      now: () => NOW,
    })
    expect(read).toHaveBeenCalledWith({ projectId: 'project-a', contentType: 'post', contentIds: ['p1'] })
    expect(r).toEqual({ items: [], timeZone: 'Europe/Rome', window: { kind: 'wentOffline', at: '2026-10-05T09:00:00Z' } })
  })
  it('a draft-only post has no window; an invalid zone is dropped', async () => {
    const r = await getPostActivity(ctx(grant()), 'project-a', 'p1', {
      client: client({ 'drafts.p1': { _type: 'post', projectSlug: 'tmz' } }, 'Not/AZone') as never,
      read: vi.fn(async () => []),
      now: () => NOW,
    })
    expect(r).toEqual({ items: [], timeZone: null, window: null })
  })
})

describe('publicationWindow', () => {
  it('scheduled, live with an end date, offline, plain live', () => {
    expect(publicationWindow({ publishedAt: '2026-11-01T09:00:00Z' }, NOW)).toEqual({ kind: 'goesLive', at: '2026-11-01T09:00:00Z' })
    expect(publicationWindow({ publishedAt: '2026-10-01T09:00:00Z', expiresAt: '2026-11-01T09:00:00Z' }, NOW)).toEqual({ kind: 'goesOffline', at: '2026-11-01T09:00:00Z' })
    expect(publicationWindow({ publishedAt: '2026-10-01T09:00:00Z', expiresAt: '2026-10-05T09:00:00Z' }, NOW)).toEqual({ kind: 'wentOffline', at: '2026-10-05T09:00:00Z' })
    expect(publicationWindow({ publishedAt: '2026-10-01T09:00:00Z' }, NOW)).toBeNull()
    expect(publicationWindow(undefined, NOW)).toBeNull()
  })
})
