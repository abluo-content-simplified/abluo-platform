import { describe, expect, it } from 'vitest'
import { CLIENT_UPLOAD_BUDGET_BYTES, cleanFrom, cleanRelatedTo, ticketErrorKey, validateNewRequest } from '../client-form'
import type { TicketFailure } from '../model'

describe('ticketErrorKey', () => {
  it('maps every failure reason to a key', () => {
    const reasons: TicketFailure[] = ['unavailable', 'forbidden', 'notFound', 'supportMode', 'rateLimited', 'closed', 'invalid', 'attachmentType', 'attachmentTooLarge', 'tooManyAttachments', 'error']
    for (const r of reasons) expect(ticketErrorKey(r)).toBe(r)
  })
  it('invalid with a field uses the field', () => {
    expect(ticketErrorKey('invalid', 'titleTooLong')).toBe('titleTooLong')
  })
  it('anything unknown becomes the generic error', () => {
    expect(ticketErrorKey('weird' as TicketFailure)).toBe('error')
  })
})

describe('validateNewRequest', () => {
  const ok = { title: 'Button broken', body: 'It does nothing', files: [] }
  it('accepts a normal request', () => expect(validateNewRequest(ok)).toEqual({}))
  it('needs a title and a description', () => {
    expect(validateNewRequest({ ...ok, title: '  ', body: '' })).toEqual({ title: 'titleRequired', body: 'bodyRequired' })
  })
  it('refuses too many or too large screenshots', () => {
    expect(validateNewRequest({ ...ok, files: [{ size: 1 }, { size: 1 }, { size: 1 }, { size: 1 }] }).files).toBe('tooMany')
    expect(validateNewRequest({ ...ok, files: [{ size: CLIENT_UPLOAD_BUDGET_BYTES }, { size: 10 }] }).files).toBeUndefined() // shrunk in the browser before sending
    expect(validateNewRequest({ ...ok, files: [{ size: 5 * 1024 * 1024 + 1 }] }).files).toBe('tooLarge')
  })
})

describe('query params', () => {
  it('relatedTo must be a ticket reference', () => {
    expect(cleanRelatedTo('abl-000123')).toBe('ABL-000123')
    expect(cleanRelatedTo('<script>')).toBeUndefined()
    expect(cleanRelatedTo(undefined)).toBeUndefined()
  })
  it('from must be a same-site path', () => {
    expect(cleanFrom('/hoffmann/posts')).toBe('/hoffmann/posts')
    expect(cleanFrom('//evil.com')).toBeUndefined()
    expect(cleanFrom('https://evil.com')).toBeUndefined()
  })
})
