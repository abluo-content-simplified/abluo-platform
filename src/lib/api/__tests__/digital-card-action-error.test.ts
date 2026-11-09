import { describe, it, expect, vi } from 'vitest'
import { mapDigitalCardActionError } from '../digital-card-action-error'
import { DigitalCardError } from '../digital-cards-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import { TranslateError } from '@/lib/translate/types'

describe('mapDigitalCardActionError', () => {
  it('keeps the module code, and what is missing for a blocked publish', () => {
    expect(mapDigitalCardActionError(new DigitalCardError('site_exists', 'x'))).toEqual({ ok: false, error: 'site_exists' })
    expect(mapDigitalCardActionError(new DigitalCardError('publish_blocked', 'x', { missing: ['person', 'urlName'] }))).toEqual({ ok: false, error: 'publish_blocked', detail: { missing: ['person', 'urlName'] } })
    expect(mapDigitalCardActionError(new DigitalCardError('url_name_taken', 'x', { field: 'urlName' }))).toEqual({ ok: false, error: 'url_name_taken', detail: { field: 'urlName' } })
  })
  it('collapses authorization and unknown failures to opaque codes', () => {
    expect(mapDigitalCardActionError(new TenantAuthorizationError('no'))).toEqual({ ok: false, error: 'forbidden' })
    expect(mapDigitalCardActionError(new Error('secret detail'))).toEqual({ ok: false, error: 'failed' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mapDigitalCardActionError(new TranslateError('quota_reached', 'x'))).toEqual({ ok: false, error: 'quota_reached' })
    spy.mockRestore()
  })
})
