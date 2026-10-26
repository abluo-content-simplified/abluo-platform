/**
 * ADR-040 B2.5 / R9 — the dashboard's Access and Documents actions answer opaque codes only:
 * never a message from the database, a path, a hash or a password.
 */
import { describe, it, expect } from 'vitest'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { toAccessActionError } from '../action-errors'
import { PasswordRejected } from '../management'
import { AccessError } from '../model'

describe('toAccessActionError', () => {
  it('maps every known failure to its code', () => {
    expect(toAccessActionError(new TenantAuthorizationError('module not installed for project …'))).toBe('forbidden')
    expect(toAccessActionError(new PasswordRejected('too_short'))).toBe('password_too_short')
    expect(toAccessActionError(new PasswordRejected('duplicate'))).toBe('password_duplicate')
    expect(toAccessActionError(new AccessError('not_found', 'site_access:not_found'))).toBe('not_found')
    expect(toAccessActionError(new AccessError('limit_reached', 'too_many_groups'))).toBe('limit_reached')
    expect(toAccessActionError(new AccessError('unavailable', 'site access tables are not installed'))).toBe('not_ready')
    expect(toAccessActionError(new AccessError('unavailable', 'site access store error'))).toBe('failed')
    expect(toAccessActionError(new AccessError('invalid_input', 'name'))).toBe('name_needed')
    expect(toAccessActionError(new AccessError('invalid_input', 'file_too_large'))).toBe('file_too_large')
    expect(toAccessActionError(new AccessError('invalid_input', '23503'))).toBe('invalid')
    // R9 Documents
    expect(toAccessActionError(new AccessError('invalid_input', 'title'))).toBe('title_needed')
    expect(toAccessActionError(new AccessError('invalid_input', 'note_too_long'))).toBe('note_too_long')
    expect(toAccessActionError(new AccessError('invalid_input', 'invalid_locale'))).toBe('locales_needed')
    expect(toAccessActionError(new AccessError('invalid_input', 'last_language'))).toBe('last_language')
    expect(toAccessActionError(new AccessError('invalid_input', 'invalid_type'))).toBe('file_type')
    expect(toAccessActionError(new AccessError('invalid_input', 'page_does_not_fit'))).toBe('page_does_not_fit')
    expect(toAccessActionError(new AccessError('invalid_input', 'invalid_page'))).toBe('page_without_section')
    expect(toAccessActionError(new AccessError('invalid_input', 'groups_unavailable'))).toBe('groups_unavailable')
  })
  it('anything else is "failed" — no message passes through', () => {
    expect(toAccessActionError(new Error('duplicate key value violates unique constraint "x" scrypt$…'))).toBe('failed')
    expect(toAccessActionError('boom')).toBe('failed')
  })
})
