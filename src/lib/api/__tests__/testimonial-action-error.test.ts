import { describe, expect, it, vi } from 'vitest'
import { mapTestimonialActionError } from '../testimonial-action-error'
import { TestimonialError } from '../testimonials-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import { TranslateError } from '@/lib/translate/types'

describe('mapTestimonialActionError', () => {
  it('keeps a testimonial error code', () => {
    expect(mapTestimonialActionError(new TestimonialError('conflict', 'x'))).toEqual({ ok: false, error: 'conflict' })
    expect(mapTestimonialActionError(new TestimonialError('private_unavailable', 'x'))).toEqual({ ok: false, error: 'private_unavailable' })
    expect(mapTestimonialActionError(new TestimonialError('submission_not_found', 'x'))).toEqual({ ok: false, error: 'submission_not_found' })
  })
  it('permission_required names the field to tick, so the editor can link to it', () => {
    expect(mapTestimonialActionError(new TestimonialError('permission_required', 'x', { field: 'permissionToPublish' }))).toEqual({
      ok: false,
      error: 'permission_required',
      detail: { field: 'permissionToPublish' },
    })
  })
  it('translate errors keep their code; provider failures are logged server-side', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mapTestimonialActionError(new TranslateError('quota_reached'))).toEqual({ ok: false, error: 'quota_reached' })
    expect(mapTestimonialActionError(new TranslateError('provider_error', 'secret detail'))).toEqual({ ok: false, error: 'provider_error' })
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })
  it('a permission refusal is forbidden and anything else is a plain failure with no detail', () => {
    expect(mapTestimonialActionError(new TenantAuthorizationError('no'))).toEqual({ ok: false, error: 'forbidden' })
    expect(mapTestimonialActionError(new Error('db password is hunter2'))).toEqual({ ok: false, error: 'failed' })
    expect(mapTestimonialActionError('weird')).toEqual({ ok: false, error: 'failed' })
  })
})
