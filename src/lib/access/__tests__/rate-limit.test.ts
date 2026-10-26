import { describe, it, expect } from 'vitest'
import { hashIp, rateLimitAddress, RATE_LIMITS } from '../rate-limit'
import { isAccessEnvironment, resolveAccessEnvironment } from '../environment'

describe('limits passed to the database', () => {
  it('per-IP under pressure is tightened but never zero; all limits positive', () => {
    expect(RATE_LIMITS.perIpProjectUnderPressure).toBeGreaterThanOrEqual(1)
    expect(RATE_LIMITS.perIpProjectUnderPressure).toBeLessThan(RATE_LIMITS.perIpProject)
    expect(Object.values(RATE_LIMITS).every((v) => Number.isInteger(v) && v > 0)).toBe(true)
  })
})

describe('session environment', () => {
  it('maps Vercel runtime variables to production | preview | dev | local', () => {
    expect(resolveAccessEnvironment({})).toBe('local')
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })).toBe('production')
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview' })).toBe('preview')
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dev' })).toBe('dev')
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' })).toBe('dev')
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'development' })).toBe('local')
  })
  it('on Vercel, a missing or unknown environment is null (fail closed) — never a default', () => {
    expect(resolveAccessEnvironment({ VERCEL: '1' })).toBeNull()
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'staging' })).toBeNull()
    expect(resolveAccessEnvironment({ VERCEL: '1', VERCEL_ENV: 'preview' })).toBeNull()
    // the build-time NEXT_PUBLIC copy (which defaults to 'development') is ignored
    expect(resolveAccessEnvironment({ VERCEL: '1', NEXT_PUBLIC_VERCEL_ENV: 'production' })).toBeNull()
  })
  it('only the four identifiers are valid', () => {
    for (const v of ['production', 'preview', 'dev', 'local']) expect(isAccessEnvironment(v)).toBe(true)
    for (const v of ['Production', 'staging', '', null, undefined, 1]) expect(isAccessEnvironment(v)).toBe(false)
  })
})

describe('rate-limit address and IP hashing', () => {
  it('IPv4 whole; IPv6 cut to /64; v4-mapped unwrapped', () => {
    expect(rateLimitAddress('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitAddress('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64')
    expect(rateLimitAddress('2001:db8:abcd:12::99')).toBe('2001:db8:abcd:12::/64')
    expect(rateLimitAddress('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(rateLimitAddress('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })
  it('two addresses in one /64 share a bucket; the hash is salted', () => {
    expect(hashIp('2001:db8:abcd:12::1', 'salt-salt-salt-salt')).toBe(hashIp('2001:db8:abcd:12:ffff::2', 'salt-salt-salt-salt'))
    expect(hashIp('203.0.113.9', 'salt-a-salt-a-salt-a')).not.toBe(hashIp('203.0.113.9', 'salt-b-salt-b-salt-b'))
    expect(hashIp('203.0.113.9', 'salt-a-salt-a-salt-a')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('refuses to hash without a salt', () => {
    expect(() => hashIp('203.0.113.9', '')).toThrow()
  })
})
