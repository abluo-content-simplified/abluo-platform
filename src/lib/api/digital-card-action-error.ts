/**
 * Digital Cards — how a server-action failure reaches the browser (ADR-049).
 * Every failure collapses to an opaque code; `publish_blocked` also lists what
 * is missing (`detail.missing`) so the editor can link to each section. Pure,
 * so the mapping is unit-tested.
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { DigitalCardError, type DigitalCardErrorCode, type DigitalCardMissing } from '@/lib/api/digital-cards-lifecycle'
import { TranslateError, type TranslateErrorCode } from '@/lib/translate/types'

export type DigitalCardActionError = 'unauthenticated' | DigitalCardErrorCode | TranslateErrorCode
export type DigitalCardActionFail = { ok: false; error: DigitalCardActionError; detail?: { missing?: DigitalCardMissing[]; field?: string } }

export function mapDigitalCardActionError(error: unknown): DigitalCardActionFail {
  if (error instanceof DigitalCardError) {
    const detail = error.detail && (error.detail.missing?.length || error.detail.field) ? { ...(error.detail.missing?.length && { missing: [...error.detail.missing] }), ...(error.detail.field && { field: error.detail.field }) } : undefined
    return { ok: false, error: error.code, ...(detail && { detail }) }
  }
  if (error instanceof TranslateError) {
    if (error.code === 'provider_error' || error.code === 'network_error') console.error('[translate] provider failure', error.message)
    return { ok: false, error: error.code }
  }
  if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
  return { ok: false, error: 'failed' }
}
