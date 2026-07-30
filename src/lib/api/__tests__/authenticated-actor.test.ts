import type { User } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  resolvePlatformRole,
  toAuthenticatedActor,
  type PlatformRole,
} from '../auth'

/**
 * Slice 2 (ADR-015 Phase 1): the central AuthenticatedActor resolver.
 * These cover the pure, I/O-free functions only. `getAuthenticatedActor()`
 * and `requireAbluoAdmin()` cross the `getUser()` HTTP boundary; no Supabase
 * mock infra exists (see prior slices) — they are boundary-tested manually and
 * deferred to the I9 API-auth-test pairing.
 */
describe('resolvePlatformRole', () => {
  it('resolves an exact "abluo_admin" match to abluo_admin', () => {
    expect(resolvePlatformRole({ platform_role: 'abluo_admin' })).toBe(
      'abluo_admin'
    )
  })

  it('resolves an explicit "tenant_user" to tenant_user', () => {
    expect(resolvePlatformRole({ platform_role: 'tenant_user' })).toBe(
      'tenant_user'
    )
  })

  it('fails safe to tenant_user when the key is missing', () => {
    expect(resolvePlatformRole({})).toBe('tenant_user')
    expect(resolvePlatformRole({ provider: 'email' })).toBe('tenant_user')
  })

  it('fails safe to tenant_user for null and undefined app_metadata', () => {
    expect(resolvePlatformRole(null)).toBe('tenant_user')
    expect(resolvePlatformRole(undefined)).toBe('tenant_user')
  })

  it('fails safe to tenant_user for a non-string platform_role value', () => {
    expect(resolvePlatformRole({ platform_role: true })).toBe('tenant_user')
    expect(resolvePlatformRole({ platform_role: 1 })).toBe('tenant_user')
    expect(resolvePlatformRole({ platform_role: null })).toBe('tenant_user')
    expect(resolvePlatformRole({ platform_role: { role: 'abluo_admin' } })).toBe(
      'tenant_user'
    )
  })

  it('fails safe to tenant_user for garbage or near-miss strings', () => {
    expect(resolvePlatformRole({ platform_role: 'admin' })).toBe('tenant_user')
    expect(resolvePlatformRole({ platform_role: 'Abluo_Admin' })).toBe(
      'tenant_user'
    )
    expect(resolvePlatformRole({ platform_role: ' abluo_admin ' })).toBe(
      'tenant_user'
    )
    expect(resolvePlatformRole({ platform_role: '' })).toBe('tenant_user')
    expect(resolvePlatformRole({ platform_role: 'superuser' })).toBe(
      'tenant_user'
    )
  })
})

describe('toAuthenticatedActor', () => {
  const baseUser = (appMetadata: Record<string, unknown>): User =>
    ({
      id: 'user-123',
      app_metadata: appMetadata,
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00Z',
    }) as unknown as User

  it('maps userId and an admin role correctly', () => {
    const actor = toAuthenticatedActor(
      baseUser({ platform_role: 'abluo_admin' })
    )
    expect(actor.userId).toBe('user-123')
    expect(actor.platformRole).toBe('abluo_admin')
  })

  it('maps userId and defaults an unset role to tenant_user', () => {
    const actor = toAuthenticatedActor(baseUser({ provider: 'email' }))
    expect(actor.userId).toBe('user-123')
    expect(actor.platformRole).toBe('tenant_user')
  })

  it('produces a value assignable to the PlatformRole union', () => {
    const role: PlatformRole = toAuthenticatedActor(
      baseUser({ platform_role: 'tenant_user' })
    ).platformRole
    expect(role).toBe('tenant_user')
  })
})
