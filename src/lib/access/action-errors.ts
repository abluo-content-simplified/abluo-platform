/**
 * Site Access — the opaque codes the dashboard's Access actions return
 * (ADR-040 B2.5). Pure; the screen translates each code.
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PasswordRejected } from './management'
import { PageAccessRefused } from './page-visibility'
import { AccessError } from './model'

export type AccessActionError =
  | 'unauthenticated'
  | 'forbidden'
  | 'support_mode'
  | 'not_ready'
  | 'not_found'
  | 'limit_reached'
  | 'name_needed'
  | 'name_too_long'
  | 'password_blank'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_duplicate'
  | 'groups_needed'
  | 'file_too_large'
  | 'page_home'
  | 'page_file_download'
  | 'page_conflict'
  | 'invalid'
  | 'failed'

export type AccessActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: AccessActionError }

export function toAccessActionError(error: unknown): AccessActionError {
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  if (error instanceof PasswordRejected) return `password_${error.problem}` as AccessActionError
  if (error instanceof PageAccessRefused) return error.reason === 'no_groups' ? 'groups_needed' : (`page_${error.reason}` as AccessActionError)
  if (error instanceof AccessError) {
    if (error.code === 'not_found') return 'not_found'
    if (error.code === 'limit_reached') return 'limit_reached'
    if (error.code === 'unavailable') return /not installed/.test(error.message) ? 'not_ready' : 'failed'
    if (error.code === 'invalid_input') {
      if (error.message === 'name') return 'name_needed'
      if (error.message === 'name_too_long') return 'name_too_long'
      if (error.message === 'groups') return 'groups_needed'
      if (error.message === 'file_too_large') return 'file_too_large'
      return 'invalid'
    }
  }
  return 'failed'
}

