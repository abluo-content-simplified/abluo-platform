import { describe, it, expect } from 'vitest'
import { MAX_CHARS_PER_REQUEST, validateTranslateRequest } from '../validate'
import { isQuotaReached, monthStartUtc, normaliseQuota, wouldExceedQuota } from '../quota'
import { TranslateError } from '../types'

function code(fn: () => unknown): string {
  try {
    fn()
    return 'ok'
  } catch (err) {
    return err instanceof TranslateError ? err.code : 'other'
  }
}

const base = { projectSlug: 'cyce', sourceLocale: 'en', targetLocales: ['fr'], texts: ['Hello'] }

describe('validateTranslateRequest', () => {
  it('accepts a valid request and computes characters × targets', () => {
    const v = validateTranslateRequest({ ...base, targetLocales: ['fr', 'de', 'fr', 'en'] })
    expect(v.targetLocales).toEqual(['fr', 'de'])
    expect(v.requestedCharacters).toBe(10)
    expect(v.format).toBe('text')
    expect(v.documentId).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(code(() => validateTranslateRequest(null))).toBe('invalid_request')
    expect(code(() => validateTranslateRequest({ ...base, projectSlug: '../x' }))).toBe('invalid_request')
    expect(code(() => validateTranslateRequest({ ...base, sourceLocale: 'xx' }))).toBe('invalid_request')
    expect(code(() => validateTranslateRequest({ ...base, targetLocales: ['en'] }))).toBe('invalid_request')
    expect(code(() => validateTranslateRequest({ ...base, texts: ['  '] }))).toBe('invalid_request')
    expect(code(() => validateTranslateRequest({ ...base, format: 'pdf' }))).toBe('invalid_request')
  })

  it('caps request size', () => {
    expect(code(() => validateTranslateRequest({ ...base, texts: ['x'.repeat(MAX_CHARS_PER_REQUEST + 1)] }))).toBe('too_large')
    expect(code(() => validateTranslateRequest({ ...base, texts: Array(51).fill('a') }))).toBe('too_large')
  })
})

describe('quota maths', () => {
  it('month starts at 00:00 UTC on the 1st', () => {
    expect(monthStartUtc(new Date('2026-09-29T23:59:00+02:00')).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('empty, zero or negative quota means no limit', () => {
    expect(normaliseQuota(undefined)).toBeNull()
    expect(normaliseQuota(0)).toBeNull()
    expect(normaliseQuota(-5)).toBeNull()
    expect(normaliseQuota('1000')).toBe(1000)
    expect(normaliseQuota(1000.7)).toBe(1000)
  })

  it('refuses a request that would cross the limit, whole', () => {
    expect(wouldExceedQuota(1000, 900, 100)).toBe(false)
    expect(wouldExceedQuota(1000, 900, 101)).toBe(true)
    expect(wouldExceedQuota(null, 1e9, 1e9)).toBe(false)
    expect(isQuotaReached(1000, 1000)).toBe(true)
    expect(isQuotaReached(null, 1e9)).toBe(false)
  })
})
