/**
 * Testimonials server actions (ADR-048): identity and grant come from the
 * shared resolveProjectAction helper, failures collapse to opaque codes, the
 * project id handed to the service is the GRANT's — never the caller's — and a
 * publish refused for the missing tick names the field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

const api = vi.hoisted(() => ({
  listTestimonials: vi.fn(),
  getTestimonial: vi.fn(),
  createTestimonial: vi.fn(),
  openTestimonialForEdit: vi.fn(),
  saveTestimonialDraft: vi.fn(),
  publishTestimonialDraft: vi.fn(),
  discardTestimonialDraft: vi.fn(),
  runTestimonialLifecycle: vi.fn(),
  getTestimonialActivity: vi.fn(),
  getTestimonialPrivate: vi.fn(),
  saveTestimonialPrivate: vi.fn(),
}))
vi.mock('@/lib/api/testimonials', async (orig) => ({ ...((await orig()) as object), ...api }))
const submissions = vi.hoisted(() => ({ listTestimonialSubmissions: vi.fn(), createTestimonialFromSubmission: vi.fn(), rejectTestimonialSubmission: vi.fn() }))
vi.mock('@/lib/api/testimonial-submissions', async (orig) => ({ ...((await orig()) as object), ...submissions }))
const translate = vi.hoisted(() => ({ translateTestimonialFields: vi.fn() }))
vi.mock('@/lib/api/testimonial-translate', async (orig) => ({ ...((await orig()) as object), ...translate }))

import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { TestimonialError } from '@/lib/api/testimonials-lifecycle'
import { TranslateError } from '@/lib/translate/types'
import {
  createTestimonialAction,
  createTestimonialFromSubmissionAction,
  listTestimonialSubmissionsAction,
  listTestimonialsAction,
  publishTestimonialDraftAction,
  rejectTestimonialSubmissionAction,
  saveTestimonialDraftAction,
  testimonialLifecycleAction,
} from '../actions'
import { getTestimonialPrivateAction, saveTestimonialPrivateAction, translateTestimonialFieldsAction } from '../editor-actions'

const ctx = { userId: 'u1', projects: [] }

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({ ok: true, ctx, grant: { projectId: 'project-a' } })
})

describe('testimonial actions', () => {
  it('pass the grant project id and the caller input to the service', async () => {
    api.listTestimonials.mockResolvedValue({ testimonials: [], site: { defaultLocale: 'it', languages: ['it'] } })
    expect(await listTestimonialsAction({ projectSlug: 'hoffmann' })).toMatchObject({ ok: true, testimonials: [] })
    expect(api.listTestimonials).toHaveBeenCalledWith(ctx, 'project-a')

    api.createTestimonial.mockResolvedValue({ id: 't1', publicId: 'p1', rev: 'r1' })
    expect(await createTestimonialAction({ projectSlug: 'hoffmann' })).toMatchObject({ ok: true, id: 't1', rev: 'r1' })
    expect(api.createTestimonial).toHaveBeenCalledWith(ctx, 'project-a', {})

    api.saveTestimonialDraft.mockResolvedValue({ rev: 'r2' })
    await saveTestimonialDraftAction({ projectSlug: 'hoffmann', id: 't1', rev: 'r1', set: { featured: true } })
    expect(api.saveTestimonialDraft).toHaveBeenCalledWith(ctx, 'project-a', { id: 't1', rev: 'r1', set: { featured: true } })

    api.runTestimonialLifecycle.mockResolvedValue({ rev: null })
    await testimonialLifecycleAction({ projectSlug: 'hoffmann', id: 't1', op: 'archive' })
    expect(api.runTestimonialLifecycle).toHaveBeenCalledWith(ctx, 'project-a', { id: 't1', op: 'archive' })

    submissions.createTestimonialFromSubmission.mockResolvedValue({ id: 't2', publicId: 'p2', rev: 'r', permissionToPublish: false, submissionMarked: true })
    expect(await createTestimonialFromSubmissionAction({ projectSlug: 'hoffmann', submissionId: 's1' })).toMatchObject({ ok: true, id: 't2', permissionToPublish: false })
    expect(submissions.createTestimonialFromSubmission).toHaveBeenCalledWith(ctx, 'project-a', 's1')
    submissions.rejectTestimonialSubmission.mockResolvedValue(undefined)
    expect(await rejectTestimonialSubmissionAction({ projectSlug: 'hoffmann', submissionId: 's1' })).toEqual({ ok: true })
  })

  it('an anonymous caller is unauthenticated and nothing is reached', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    for (const r of [
      await listTestimonialsAction({ projectSlug: 'x' }),
      await createTestimonialAction({ projectSlug: 'x' }),
      await publishTestimonialDraftAction({ projectSlug: 'x', id: 't1', rev: 'r' }),
      await testimonialLifecycleAction({ projectSlug: 'x', id: 't1', op: 'deletePermanently' }),
      await listTestimonialSubmissionsAction({ projectSlug: 'x' }),
      await createTestimonialFromSubmissionAction({ projectSlug: 'x', submissionId: 's' }),
      await getTestimonialPrivateAction({ projectSlug: 'x', id: 't1' }),
      await saveTestimonialPrivateAction({ projectSlug: 'x', id: 't1', version: null, set: { note: 'x' } }),
      await translateTestimonialFieldsAction({ projectSlug: 'x', id: 't1', fields: ['body'], sourceLocale: 'it' }),
    ]) {
      expect(r).toMatchObject({ ok: false, error: 'unauthenticated' })
    }
    for (const group of [api, submissions, translate]) expect(Object.values(group).every((f) => f.mock.calls.length === 0)).toBe(true)
  })

  it('a project the caller cannot reach is forbidden', async () => {
    access.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect(await testimonialLifecycleAction({ projectSlug: 'other', id: 't1', op: 'archive' })).toMatchObject({ ok: false, error: 'forbidden' })
    expect(api.runTestimonialLifecycle).not.toHaveBeenCalled()
  })

  it('publish without the tick comes back as permission_required naming the field', async () => {
    api.publishTestimonialDraft.mockRejectedValueOnce(new TestimonialError('permission_required', 'Tick it.', { field: 'permissionToPublish' }))
    expect(await publishTestimonialDraftAction({ projectSlug: 'hoffmann', id: 't1', rev: 'r1' })).toEqual({
      ok: false,
      error: 'permission_required',
      detail: { field: 'permissionToPublish' },
    })
  })

  it('maps a permission refusal to forbidden, a testimonial error to its code, anything else to failed (no message leaks)', async () => {
    api.saveTestimonialDraft.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await saveTestimonialDraftAction({ projectSlug: 'h', id: 't1', rev: 'r', set: {} })).toMatchObject({ ok: false, error: 'forbidden' })
    api.runTestimonialLifecycle.mockRejectedValueOnce(new TestimonialError('archive_first', 'x'))
    expect(await testimonialLifecycleAction({ projectSlug: 'h', id: 't1', op: 'deletePermanently' })).toMatchObject({ ok: false, error: 'archive_first' })
    submissions.createTestimonialFromSubmission.mockRejectedValueOnce(new TestimonialError('conflict', 'x'))
    expect(await createTestimonialFromSubmissionAction({ projectSlug: 'h', submissionId: 's' })).toMatchObject({ ok: false, error: 'conflict' })
    submissions.createTestimonialFromSubmission.mockRejectedValueOnce(new TestimonialError('private_unavailable', 'x'))
    expect(await createTestimonialFromSubmissionAction({ projectSlug: 'h', submissionId: 's' })).toMatchObject({ ok: false, error: 'private_unavailable' })
    api.getTestimonial.mockRejectedValueOnce(new Error('connection string postgres://secret'))
    const { getTestimonialAction } = await import('../actions')
    const r = await getTestimonialAction({ projectSlug: 'h', id: 't1' })
    expect(r).toEqual({ ok: false, error: 'failed' })
  })
})

describe('editor actions', () => {
  it('translate goes through the service with the grant project and returns its result', async () => {
    translate.translateTestimonialFields.mockResolvedValue({ results: { body: { de: { text: 'x', meta: { status: 'machine' } } } }, skipped: [], usage: null })
    const r = await translateTestimonialFieldsAction({ projectSlug: 'h', id: 't1', fields: ['body'], sourceLocale: 'it' })
    expect(r).toMatchObject({ ok: true, results: { body: { de: { text: 'x' } } } })
    expect(translate.translateTestimonialFields).toHaveBeenCalledWith(ctx, 'project-a', { id: 't1', fields: ['body'], sourceLocale: 'it' })
  })

  it('translate errors keep their code (quota, module off)', async () => {
    translate.translateTestimonialFields.mockRejectedValueOnce(new TranslateError('quota_reached'))
    expect(await translateTestimonialFieldsAction({ projectSlug: 'h', id: 't1', fields: ['body'], sourceLocale: 'it' })).toMatchObject({ ok: false, error: 'quota_reached' })
    translate.translateTestimonialFields.mockRejectedValueOnce(new TranslateError('module_disabled'))
    expect(await translateTestimonialFieldsAction({ projectSlug: 'h', id: 't1', fields: ['body'], sourceLocale: 'it' })).toMatchObject({ ok: false, error: 'module_disabled' })
  })

  it('private details: the service decides (testimonials.private.read); a refusal is forbidden', async () => {
    api.getTestimonialPrivate.mockRejectedValueOnce(new TenantAuthorizationError('no'))
    expect(await getTestimonialPrivateAction({ projectSlug: 'h', id: 't1' })).toMatchObject({ ok: false, error: 'forbidden' })
    api.saveTestimonialPrivate.mockResolvedValue({ version: 2, fullName: 'Anna Rossi' })
    expect(await saveTestimonialPrivateAction({ projectSlug: 'h', id: 't1', version: 1, set: { fullName: 'Anna Rossi' } })).toMatchObject({ ok: true, row: { version: 2 } })
    expect(api.saveTestimonialPrivate).toHaveBeenCalledWith(ctx, 'project-a', { id: 't1', version: 1, set: { fullName: 'Anna Rossi' } })
    api.saveTestimonialPrivate.mockRejectedValueOnce(new TestimonialError('private_unavailable', 'x'))
    expect(await saveTestimonialPrivateAction({ projectSlug: 'h', id: 't1', version: null, set: { note: 'x' } })).toMatchObject({ ok: false, error: 'private_unavailable' })
  })
})
