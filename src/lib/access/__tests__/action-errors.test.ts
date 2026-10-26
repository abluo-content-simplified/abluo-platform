/**
 * ADR-040 B2.5 — the dashboard's Access actions answer opaque codes only:
 * never a message from the database, a path, a hash or a password.
 */
import { describe, it, expect } from 'vitest'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { toAccessActionError } from '../action-errors'
import { PasswordRejected } from '../management'
import { PageAccessRefused } from '../page-visibility'
import { AccessError } from '../model'

describe('toAccessActionError', () => {
  it('maps every known failure to its code', () => {
    expect(toAccessActionError(new TenantAuthorizationError('module not installed for project …'))).toBe('forbidden')
    expect(toAccessActionError(new PasswordRejected('too_short'))).toBe('password_too_short')
    expect(toAccessActionError(new PasswordRejected('duplicate'))).toBe('password_duplicate')
    expect(toAccessActionError(new PageAccessRefused('file_download'))).toBe('page_file_download')
    expect(toAccessActionError(new PageAccessRefused('home'))).toBe('page_home')
    expect(toAccessActionError(new PageAccessRefused('conflict'))).toBe('page_conflict')
    expect(toAccessActionError(new PageAccessRefused('no_groups'))).toBe('groups_needed')
    expect(toAccessActionError(new AccessError('not_found', 'site_access:not_found'))).toBe('not_found')
    expect(toAccessActionError(new AccessError('limit_reached', 'too_many_groups'))).toBe('limit_reached')
    expect(toAccessActionError(new AccessError('unavailable', 'site access tables are not installed'))).toBe('not_ready')
    expect(toAccessActionError(new AccessError('unavailable', 'site access store error'))).toBe('failed')
    expect(toAccessActionError(new AccessError('invalid_input', 'name'))).toBe('name_needed')
    expect(toAccessActionError(new AccessError('invalid_input', 'file_too_large'))).toBe('file_too_large')
    expect(toAccessActionError(new AccessError('invalid_input', '23503'))).toBe('invalid')
  })
  it('anything else is "failed" — no message passes through', () => {
    expect(toAccessActionError(new Error('duplicate key value violates unique constraint "x" scrypt$…'))).toBe('failed')
    expect(toAccessActionError('boom')).toBe('failed')
  })
})
