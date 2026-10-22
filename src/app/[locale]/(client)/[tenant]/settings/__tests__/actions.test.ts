/**
 * Settings server actions: identity and grant come from the shared
 * resolveProjectAction helper, failures collapse to opaque codes, and the
 * project id handed to the service is the GRANT's — never the caller's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
const revalidate = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath: revalidate }))
const service = vi.hoisted(() => ({ saveSettings: vi.fn() }))
vi.mock('@/lib/settings/service', async (orig) => ({ ...((await orig()) as object), ...service }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { SettingsError } from '@/lib/settings/service'
import { saveSettingsAction } from '../actions'

const ctx = { userId: 'u1', projects: [] }
beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, ctx, grant: { projectId: 'project-a' } })
})

describe('saveSettingsAction', () => {
  it('passes the grant project id and the input, returns the new rev, and revalidates', async () => {
    service.saveSettings.mockResolvedValue({ rev: 'n1|p1' })
    const r = await saveSettingsAction({ projectSlug: 'trattoria', rev: 's1|p1', set: { amazonTrackingIds: [] } })
    expect(r).toMatchObject({ ok: true, rev: 'n1|p1' })
    expect(service.saveSettings).toHaveBeenCalledWith(ctx, 'project-a', { rev: 's1|p1', set: { amazonTrackingIds: [] } })
    expect(revalidate).toHaveBeenCalled()
  })
  it('an anonymous caller is unauthenticated; the service is not reached', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    expect(await saveSettingsAction({ projectSlug: 'x', rev: '', set: {} })).toMatchObject({ ok: false, error: 'unauthenticated' })
    expect(service.saveSettings).not.toHaveBeenCalled()
  })
  it('maps service failures to opaque codes and does not revalidate', async () => {
    service.saveSettings.mockRejectedValueOnce(new SettingsError('conflict'))
    expect(await saveSettingsAction({ projectSlug: 'x', rev: 'a|b', set: {} })).toMatchObject({ ok: false, error: 'conflict' })
    service.saveSettings.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await saveSettingsAction({ projectSlug: 'x', rev: 'a|b', set: {} })).toMatchObject({ ok: false, error: 'forbidden' })
    service.saveSettings.mockRejectedValueOnce(new Error('boom'))
    expect(await saveSettingsAction({ projectSlug: 'x', rev: 'a|b', set: {} })).toMatchObject({ ok: false, error: 'failed' })
    expect(revalidate).not.toHaveBeenCalled()
  })
  it('passes Awin fields through to the service unchanged', async () => {
    service.saveSettings.mockResolvedValue({ rev: 'n2|p1' })
    const set = { awinPublisherId: '123456', affiliateShops: ['ibs', 'amazon'] }
    expect(await saveSettingsAction({ projectSlug: 'trattoria', rev: 's1|p1', set })).toMatchObject({ ok: true, rev: 'n2|p1' })
    expect(service.saveSettings).toHaveBeenCalledWith(ctx, 'project-a', { rev: 's1|p1', set })
  })
  it('an invalid Awin value comes back as invalid_value', async () => {
    service.saveSettings.mockRejectedValueOnce(new SettingsError('invalid_value'))
    expect(await saveSettingsAction({ projectSlug: 'x', rev: 'a|b', set: { awinPublisherId: 'abc' } })).toMatchObject({ ok: false, error: 'invalid_value' })
  })
})
