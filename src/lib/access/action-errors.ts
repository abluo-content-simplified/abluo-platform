/**
 * Site Access — the opaque codes the dashboard's Access and Documents actions
 * return (ADR-040 B2.5, R9). Pure; the screens translate each code.
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PasswordRejected } from './management'
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
  // Documents (R9, ADR-040 §15)
  | 'title_needed'
  | 'title_too_long'
  | 'note_too_long'
  | 'locales_needed'
  | 'last_language'
  | 'file_type'
  | 'page_does_not_fit'
  | 'page_without_section'
  | 'groups_unavailable'
  | 'term_unknown'
  | 'not_archived'
  | 'invalid'
  | 'failed'

export type AccessActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: AccessActionError }

export function toAccessActionError(error: unknown): AccessActionError {
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  if (error instanceof PasswordRejected) return `password_${error.problem}` as AccessActionError
  if (error instanceof AccessError) {
    if (error.code === 'not_found') return 'not_found'
    if (error.code === 'limit_reached') return 'limit_reached'
    if (error.code === 'unavailable') return /not installed/.test(error.message) ? 'not_ready' : 'failed'
    if (error.code === 'invalid_input') {
      if (error.message === 'name') return 'name_needed'
      if (error.message === 'name_too_long') return 'name_too_long'
      if (error.message === 'groups') return 'groups_needed'
      if (error.message === 'file_too_large' || error.message === 'too_large') return 'file_too_large'
      if (error.message === 'no_groups' || error.message === 'unknown_group') return 'groups_needed'
      if (error.message === 'title') return 'title_needed'
      if (error.message === 'title_too_long') return 'title_too_long'
      if (error.message === 'note_too_long') return 'note_too_long'
      if (error.message === 'locales' || error.message === 'invalid_locale') return 'locales_needed'
      if (error.message === 'last_language') return 'last_language'
      if (error.message === 'file_type' || error.message === 'invalid_type') return 'file_type'
      if (error.message === 'page_does_not_fit') return 'page_does_not_fit'
      if (error.message === 'page_without_section' || error.message === 'invalid_page') return 'page_without_section'
      if (error.message === 'groups_unavailable') return 'groups_unavailable'
      if (error.message === 'unknown_term') return 'term_unknown'
      if (error.message === 'not_archived') return 'not_archived'
      return 'invalid'
    }
  }
  return 'failed'
}

