/**
 * Settings server actions (form notifications, 2026-10-28): identity and grant
 * come from the shared resolveProjectAction helper, failures collapse to opaque
 * codes, and the project id handed to the service is the GRANT's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const service = vi.hoisted(() => ({ changeFormRecipient: vi.fn() }))
vi.mock('@/lib/notifications/form-recipients-service', async (orig) => ({ ...((await orig()) as object), ...service }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { FormNotificationsError } from '@/lib/notifications/form-recipients-service'
import { addFormRecipientAction, removeFormRecipientAction } from '../actions'

const ctx = { userId: 'u1', projects: [] }
const input = { projectSlug: 'cyce', locale: 'it', rev: 'r1', groupKey: 'kc', email: 'a@x.it' }
beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, ctx, grant: { projectId: 'project-a' } })
})

describe('form recipient actions', () => {
  it('pass the grant project id and the input to the service', async () => {
    service.changeFormRecipient.mockResolvedValue({ view: { rev: 'r2', groups: [], canWrite: true }, notice: 'sent' })
    expect(await addFormRecipientAction(input)).toMatchObject({ ok: true, notice: 'sent' })
    expect(service.changeFormRecipient).toHaveBeenCalledWith(ctx, 'project-a', { op: 'add', rev: 'r1', groupKey: 'kc', email: 'a@x.it', locale: 'it' })
    await removeFormRecipientAction(input)
    expect(service.changeFormRecipient).toHaveBeenLastCalledWith(ctx, 'project-a', expect.objectContaining({ op: 'remove' }))
  })
  it('an anonymous or ungranted caller never reaches the service', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    expect(await addFormRecipientAction(input)).toEqual({ ok: false, error: 'unauthenticated' })
    access.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect(await removeFormRecipientAction(input)).toEqual({ ok: false, error: 'forbidden' })
    expect(service.changeFormRecipient).not.toHaveBeenCalled()
  })
  it('maps failures to opaque codes', async () => {
    service.changeFormRecipient.mockRejectedValueOnce(new FormNotificationsError('too_many'))
    expect(await addFormRecipientAction(input)).toEqual({ ok: false, error: 'too_many' })
    service.changeFormRecipient.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await addFormRecipientAction(input)).toEqual({ ok: false, error: 'forbidden' })
    service.changeFormRecipient.mockRejectedValueOnce(new Error('boom'))
    expect(await addFormRecipientAction(input)).toEqual({ ok: false, error: 'failed' })
  })
})
