import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(), runAsTrustedSystemOperation: vi.fn() }))
vi.mock('@/lib/api/auth', () => ({ requireAbluoAdmin: vi.fn(async () => null) }))

import { mapProjectRow, openInvitations } from '../shared'
import { invitationTarget, getAdminHome } from '../home'
import { getAdminProject, projectInvitations, requestsGlanceFromCounts, requestWindowStart, summarizeOverview } from '../project'
import { AdminAccessError, listAdminProjects } from '../projects'
import { createAdminClient } from '@/lib/supabase/admin'

const NOW = Date.parse('2026-10-08T12:00:00Z')

describe('admin providers refuse non-admins before reading anything', () => {
  it('throws AdminAccessError and never builds a service-role client', async () => {
    await expect(listAdminProjects()).rejects.toBeInstanceOf(AdminAccessError)
    await expect(getAdminHome()).rejects.toBeInstanceOf(AdminAccessError)
    await expect(getAdminProject('x', { locale: 'en' })).rejects.toBeInstanceOf(AdminAccessError)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('admin providers (pure parts)', () => {
  it('maps a project row with its client join (object or array)', () => {
    const base = { id: 'p1', slug: 'hoffmann', name: 'Hoffmann', custom_domain: ' ch-psicoterapeuta.com ', default_locale: 'it', status: 'preview', created_at: '2026-01-01', tenant_id: 't1' }
    expect(mapProjectRow({ ...base, tenants: { display_name: 'Claudia Hoffmann', slug: 'hoffmann' } })).toEqual({
      id: 'p1',
      slug: 'hoffmann',
      name: 'Hoffmann',
      status: 'preview',
      customDomain: 'ch-psicoterapeuta.com',
      defaultLocale: 'it',
      createdAt: '2026-01-01',
      tenantId: 't1',
      client: { name: 'Claudia Hoffmann', slug: 'hoffmann' },
    })
    expect(mapProjectRow({ ...base, custom_domain: '', tenants: [{ display_name: 'X', slug: 'x' }] })).toMatchObject({ customDomain: null, client: { name: 'X' } })
    expect(mapProjectRow({ ...base, tenants: null }).client).toBeNull()
  })

  it('keeps only open invitations and finds where each leads', () => {
    const rows = openInvitations([
      { id: 'a', email: 'a@x.it', role: 'editor', scope_type: 'project', project_id: 'p1', tenant_id: null, created_at: '2026-10-01', expires_at: '2026-10-09' },
      { id: 'b', email: 'b@x.it', role: 'owner', scope_type: 'tenant', project_id: null, tenant_id: 't1', created_at: '2026-10-02', expires_at: '2026-10-05' },
      { id: 'c', email: 'c@x.it', role: 'editor', scope_type: 'project', project_id: 'p1', accepted_at: '2026-10-03' },
      { id: 'd', email: 'd@x.it', role: 'editor', scope_type: 'project', project_id: 'p2', revoked_at: '2026-10-03' },
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    const projects = [
      { id: 'p1', slug: 'one', name: 'One', tenantId: 't1' },
      { id: 'p2', slug: 'two', name: 'Two', tenantId: 't2' },
    ]
    expect(invitationTarget(rows[0], projects)).toEqual({ slug: 'one', name: 'One' })
    expect(invitationTarget(rows[1], projects)).toEqual({ slug: 'one', name: 'One' })
    expect(invitationTarget({ projectId: 'zz', tenantId: null }, projects)).toBeNull()

    const mine = projectInvitations(rows, { id: 'p2', tenantId: 't1' }, NOW)
    expect(mine.map((i) => [i.id, i.scope, i.expired])).toEqual([['b', 'tenant', true]])
  })

  it('summarizes the Sanity overview like the client Home tiles', () => {
    const out = summarizeOverview(
      {
        project: { enabledModuleIds: ['blog', 'gallery', 'blog'] },
        site: { defaultLocale: 'it', supportedLocales: ['it', 'en'] },
        posts: [
          { _id: '1', status: 'published' },
          { _id: '2', status: 'scheduled' },
          { _id: '3', status: 'draft' },
          { _id: '4', status: 'published' },
        ],
        latestPosts: [{ _id: '2', title: { it: 'Ciao', en: 'Hello' }, publishedAt: '2026-10-10', status: 'scheduled' }],
        galleryCount: 2,
        latestGalleries: [{ _id: 'g', title: null, internalName: 'Studio', count: 7 }],
        mediaTotal: 3,
        mediaAlts: [{ it: 'Una foto' }, null, { en: 'English only' }],
      },
      'en',
    )
    expect(out.enabledModuleIds).toEqual(['blog', 'gallery'])
    expect(out.posts).toEqual({ published: 2, scheduled: 1, drafts: 1 })
    expect(out.latestPosts[0]).toMatchObject({ title: 'Hello', status: 'scheduled', thumb: null })
    expect(out.latestGalleries[0]).toEqual({ id: 'g', title: 'Studio', thumb: null, count: 7 })
    expect(out.media).toEqual({ photos: 3, missingAlt: 2 })
    expect(summarizeOverview(null, 'en')).toMatchObject({ enabledModuleIds: [], galleryCount: 0, media: { photos: 0, missingAlt: 0 } })
  })
})

describe('admin project requests glance (exact head counts)', () => {
  it('windows are the client Home\'s 7-day weeks', () => {
    expect(requestWindowStart(NOW, 1)).toBe('2026-10-01T12:00:00.000Z')
    expect(requestWindowStart(NOW, 2)).toBe('2026-09-24T12:00:00.000Z')
  })

  it('maps counts past 1000 unchanged, a missing count to 0', () => {
    expect(requestsGlanceFromCounts({ open: 1234, week: 1500, previousWeek: null })).toEqual({ open: 1234, week: 1500, previousWeek: 0 })
  })
})
