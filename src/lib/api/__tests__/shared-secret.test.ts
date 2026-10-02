import { describe, it, expect } from 'vitest'
import { bearerMatches, secretEquals } from '../shared-secret'

describe('secretEquals', () => {
  it('matches only the exact secret', () => {
    expect(secretEquals('s3cret', 's3cret')).toBe(true)
    expect(secretEquals('s3cret ', 's3cret')).toBe(false)
    expect(secretEquals('S3cret', 's3cret')).toBe(false)
    expect(secretEquals('s3', 's3cret')).toBe(false)
  })

  it('fails closed on an unset or empty configured secret', () => {
    expect(secretEquals('', '')).toBe(false)
    expect(secretEquals('anything', undefined)).toBe(false)
    expect(secretEquals(undefined, undefined)).toBe(false)
    expect(secretEquals(null, 's3cret')).toBe(false)
  })
})

describe('bearerMatches', () => {
  it('requires the exact "Bearer <secret>" header', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true)
    expect(bearerMatches('s3cret', 's3cret')).toBe(false)
    expect(bearerMatches('Bearer s3cret2', 's3cret')).toBe(false)
  })

  it('never matches "Bearer undefined" when the secret is unset', () => {
    expect(bearerMatches('Bearer undefined', undefined)).toBe(false)
    expect(bearerMatches('Bearer ', '')).toBe(false)
  })
})
