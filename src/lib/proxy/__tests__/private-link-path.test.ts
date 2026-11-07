import { describe, expect, it } from 'vitest'
import { isPrivateLinkPath } from '@/lib/proxy/draft-preview'
import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'

const T = 'AbC_dEf-123456789012345678901234567890123'

describe('isPrivateLinkPath', () => {
  it.each([
    `/it/booking/${T}`, `/booking/${T}`, `/it/my-pass/${T}`, `/my-pass/${T}/`,
    `/it/cyce/booking/${T}`, `/cyce/my-pass/${T}`, `/en/some-club/my-pass/${T}`,
  ])('marks %s', (p) => expect(isPrivateLinkPath(p)).toBe(true))

  it.each([
    '/booking', '/it/booking', '/it/booking/short', `/it/booking/${T}/extra`, `/it/blog/${T}`, `/it/preview/post/${T}`,
    `/it/cyce/other/booking/${T}`, `/it/booking/${T}?x=1`, '/it/cyce/bookings',
  ])('does not mark %s', (p) => expect(isPrivateLinkPath(p)).toBe(false))

  it('both segments are reserved words (no tenant or project can be called that)', () => {
    expect(RESERVED_SLUGS).toContain('booking')
    expect(RESERVED_SLUGS).toContain('my-pass')
  })
})
