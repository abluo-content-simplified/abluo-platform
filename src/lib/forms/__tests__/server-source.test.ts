import { describe, it, expect } from 'vitest'
import { sanitizeGeoHeader, serverSourceEnrichment, deviceTypeFromUserAgent } from '@/lib/forms/server-source'
import {
  sanitizeSourceObject,
  ALLOWED_SOURCE_KEYS,
  MAX_SOURCE_URL_VALUE_LENGTH,
  MAX_SOURCE_VALUE_LENGTH,
} from '@/lib/forms/request-limits'

describe('server-derived source keys', () => {
  it('decodes, strips control characters, trims and bounds geo headers', () => {
    expect(sanitizeGeoHeader('S%C3%A3o%20Paulo', true)).toBe('São Paulo')
    expect(sanitizeGeoHeader('%E0%A4%A', true)).toBe('%E0%A4%A') // malformed → raw kept
    expect(sanitizeGeoHeader(' IT\u0000\n ')).toBe('IT')
    expect(sanitizeGeoHeader('')).toBeNull()
    expect(sanitizeGeoHeader(null)).toBeNull()
    expect(sanitizeGeoHeader('x'.repeat(500))!.length).toBe(128)
  })

  it('omits keys whose header is absent (local dev, non-Vercel host)', () => {
    expect(serverSourceEnrichment(new Headers())).toEqual({ device_type: 'desktop' })
  })

  it('classifies the device coarsely', () => {
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet')
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('mobile')
    expect(deviceTypeFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('desktop')
  })
})

describe('source whitelist — lead-origin keys', () => {
  const newKeys = [
    'browser_language', 'timezone',
    'landing_page_url', 'landing_page_path', 'first_referrer', 'first_referrer_domain',
    'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_utm_term', 'first_utm_content',
    'first_gclid', 'first_fbclid', 'session_started_at', 'pages_viewed', 'seconds_to_submit',
    'region', 'city',
  ]

  it('allows every new key', () => {
    for (const k of newKeys) expect(ALLOWED_SOURCE_KEYS).toContain(k)
  })

  it('bounds URL-ish first-touch keys at the long cap and everything else at the short cap', () => {
    const long = 'u'.repeat(5_000)
    const out = sanitizeSourceObject({
      landing_page_url: long,
      first_referrer: long,
      landing_page_path: long,
      first_utm_campaign: long,
    })
    expect((out.landing_page_url as string).length).toBe(MAX_SOURCE_URL_VALUE_LENGTH)
    expect((out.first_referrer as string).length).toBe(MAX_SOURCE_URL_VALUE_LENGTH)
    expect((out.landing_page_path as string).length).toBe(MAX_SOURCE_VALUE_LENGTH)
    expect((out.first_utm_campaign as string).length).toBe(MAX_SOURCE_VALUE_LENGTH)
  })

  it('keeps numeric counters and drops nested / unknown values', () => {
    const out = sanitizeSourceObject({ pages_viewed: 3, seconds_to_submit: 42, timezone: { a: 1 }, ip: '1.2.3.4' })
    expect(out).toEqual({ pages_viewed: 3, seconds_to_submit: 42 })
  })
})
