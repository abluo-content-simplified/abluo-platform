/**
 * Testimonials — how a server-action failure reaches the browser (ADR-048).
 * Every failure collapses to an opaque code; `permission_required` also names
 * the field the person must tick (`detail.field === 'permissionToPublish'`),
 * which is what lets the editor link straight to it. Pure, so the mapping is
 * unit-tested (src/lib/api/__tests__/testimonial-action-error.test.ts).
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { TestimonialError, type TestimonialErrorCode } from '@/lib/api/testimonials-lifecycle'
import { TranslateError, type TranslateErrorCode } from '@/lib/translate/types'

export type TestimonialActionError = 'unauthenticated' | TestimonialErrorCode | TranslateErrorCode
export type TestimonialActionFail = { ok: false; error: TestimonialActionError; detail?: { field?: string } }

export function mapTestimonialActionError(error: unknown): TestimonialActionFail {
  if (error instanceof TestimonialError) return { ok: false, error: error.code, ...(error.detail?.field && { detail: { field: error.detail.field } }) }
  if (error instanceof TranslateError) {
    if (error.code === 'provider_error' || error.code === 'network_error') console.error('[translate] provider failure', error.message)
    return { ok: false, error: error.code }
  }
  if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
  return { ok: false, error: 'failed' }
}
