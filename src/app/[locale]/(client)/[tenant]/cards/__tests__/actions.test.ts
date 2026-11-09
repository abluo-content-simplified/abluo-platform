/**
 * Digital Cards server actions (ADR-049): identity and grant come from the
 * shared resolveProjectAction helper, failures collapse to opaque codes, the
 * project id handed to the service is the GRANT's — never the caller's — and a
 * blocked publish lists what is missing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

const api = vi.hoisted(() => ({
  getDigitalCard: vi.fn(),
  createSiteCard: vi.fn(),
  createPersonCard: vi.fn(),
  openDigitalCardForEdit: vi.fn(),
  saveDigitalCardDraft: vi.fn(),
  publishDigitalCardDraft: vi.fn(),
  discardDigitalCardDraft: vi.fn(),
  runDigitalCardLifecycle: vi.fn(),
  checkDigitalCardUrlName: vi.fn(),
  getDigitalCardStats: vi.fn(),
}))
vi.mock('@/lib/api/digital-cards', async (orig) => ({ ...((await orig()) as object), ...api }))
const translate = vi.hoisted(() => ({ translateDigitalCard: vi.fn() }))
vi.mock('@/lib/api/digital-card-translate', async (orig) => ({ ...((await orig()) as object), ...translate }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { DigitalCardError } from '@/lib/api/digital-cards-lifecycle'
import {
  checkDigitalCardUrlNameAction,
  createPersonCardAction,
  createSiteCardAction,
  digitalCardLifecycleAction,
  getDigitalCardAction,
  getDigitalCardStatsAction,
  publishDigitalCardDraftAction,
  saveDigitalCardDraftAction,
  translateDigitalCardAction,
} from '../actions'

const ctx = { userId: 'u1', projects: [] }

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, ctx, grant: { projectId: 'project-a' } })
})

describe('digital card actions', () => {
  it('pass the grant project id and the caller input to the service', async () => {
    api.createSiteCard.mockResolvedValue({ id: 'c1', publicId: 'p1', rev: 'r1' })
    expect(await createSiteCardAction({ projectSlug: 'cyce' })).toMatchObject({ ok: true, id: 'c1' })
    expect(api.createSiteCard).toHaveBeenCalledWith(ctx, 'project-a')

    api.createPersonCard.mockResolvedValue({ id: 'c2', publicId: 'p2', rev: 'r1', urlName: 'anna' })
    expect(await createPersonCardAction({ projectSlug: 'cyce', personId: 'person-anna' })).toMatchObject({ ok: true, urlName: 'anna' })
    expect(api.createPersonCard).toHaveBeenCalledWith(ctx, 'project-a', { personId: 'person-anna' })

    api.saveDigitalCardDraft.mockResolvedValue({ rev: 'r2' })
    await saveDigitalCardDraftAction({ projectSlug: 'cyce', id: 'c1', rev: 'r1', set: { 'show.phone': true } })
    expect(api.saveDigitalCardDraft).toHaveBeenCalledWith(ctx, 'project-a', { id: 'c1', rev: 'r1', set: { 'show.phone': true } })

    api.runDigitalCardLifecycle.mockResolvedValue({ rev: null })
    await digitalCardLifecycleAction({ projectSlug: 'cyce', id: 'c1', op: 'archive' })
    expect(api.runDigitalCardLifecycle).toHaveBeenCalledWith(ctx, 'project-a', { id: 'c1', op: 'archive' })

    api.checkDigitalCardUrlName.mockResolvedValue({ valid: true, available: true, suggestion: 'anna' })
    expect(await checkDigitalCardUrlNameAction({ projectSlug: 'cyce', id: 'c2', urlName: 'anna' })).toMatchObject({ ok: true, available: true })

    api.getDigitalCardStats.mockResolvedValue({ available: false })
    expect(await getDigitalCardStatsAction({ projectSlug: 'cyce', id: 'c1', days: 30 })).toEqual({ ok: true, stats: { available: false } })
    expect(api.getDigitalCardStats).toHaveBeenCalledWith(ctx, 'project-a', { id: 'c1', days: 30 })

    translate.translateDigitalCard.mockResolvedValue({ description: { en: 'x' }, labels: {}, usage: null })
    expect(await translateDigitalCardAction({ projectSlug: 'cyce', id: 'c1', sourceLocale: 'it' })).toMatchObject({ ok: true, description: { en: 'x' } })
    expect(translate.translateDigitalCard).toHaveBeenCalledWith(ctx, 'project-a', { id: 'c1', sourceLocale: 'it' })
  })

  it('an anonymous caller is unauthenticated and nothing is reached', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    for (const r of [
      await createSiteCardAction({ projectSlug: 'x' }),
      await publishDigitalCardDraftAction({ projectSlug: 'x', id: 'c1', rev: 'r' }),
      await digitalCardLifecycleAction({ projectSlug: 'x', id: 'c1', op: 'deletePermanently' }),
      await getDigitalCardStatsAction({ projectSlug: 'x', id: 'c1', days: 7 }),
      await translateDigitalCardAction({ projectSlug: 'x', id: 'c1', sourceLocale: 'it' }),
    ]) {
      expect(r).toMatchObject({ ok: false, error: 'unauthenticated' })
    }
    for (const group of [api, translate]) expect(Object.values(group).every((f) => f.mock.calls.length === 0)).toBe(true)
  })

  it('a blocked publish lists what is missing; errors collapse to opaque codes', async () => {
    api.publishDigitalCardDraft.mockRejectedValueOnce(new DigitalCardError('publish_blocked', 'x', { missing: ['urlName'] }))
    expect(await publishDigitalCardDraftAction({ projectSlug: 'cyce', id: 'c1', rev: 'r1' })).toEqual({ ok: false, error: 'publish_blocked', detail: { missing: ['urlName'] } })
    api.saveDigitalCardDraft.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await saveDigitalCardDraftAction({ projectSlug: 'cyce', id: 'c1', rev: 'r', set: {} })).toEqual({ ok: false, error: 'forbidden' })
    api.getDigitalCard.mockRejectedValueOnce(new Error('connection string postgres://secret'))
    expect(await getDigitalCardAction({ projectSlug: 'cyce', id: 'c1' })).toEqual({ ok: false, error: 'failed' })
  })
})
