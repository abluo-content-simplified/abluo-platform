/**
 * Tenant → projectSlug mapping resolution
 *
 * WHY THIS TEST EXISTS:
 * The public website route boundary (`(website)/[tenant]/layout.tsx`) must
 * fail closed to `notFound()` for an unmapped tenant slug (retired flat
 * routes, typos, dead links falling through to the `[tenant]` dynamic
 * segment) rather than let a raw `Error` throw and produce an unhandled
 * error page. `tryTenantToProjectSlug()` is the non-throwing lookup that
 * makes that guard possible; `tenantToProjectSlug()` must keep throwing
 * unchanged for internal/admin callers (e.g.
 * `getTenantAuthorizationContext` → `fetchEnabledModuleIds`) that rely on
 * the throw and catch it explicitly.
 */
import { describe, it, expect } from 'vitest'
import { tenantToProjectSlug, tryTenantToProjectSlug } from '@/lib/sanity/client'

describe('tryTenantToProjectSlug', () => {
  it('resolves a mapped tenant slug to its Sanity projectSlug', () => {
    expect(tryTenantToProjectSlug('livener')).toBe('livener-main')
    expect(tryTenantToProjectSlug('studiomartegani')).toBe('studiomartegani-main')
  })

  it('returns null (never throws) for an unmapped tenant slug', () => {
    expect(tryTenantToProjectSlug('leads')).toBeNull()
    expect(tryTenantToProjectSlug('some-typo')).toBeNull()
    expect(tryTenantToProjectSlug('')).toBeNull()
  })
})

describe('tenantToProjectSlug', () => {
  it('resolves a mapped tenant slug to its Sanity projectSlug', () => {
    expect(tenantToProjectSlug('livener')).toBe('livener-main')
  })

  it('still throws for an unmapped tenant slug — internal/admin callers rely on this', () => {
    expect(() => tenantToProjectSlug('leads')).toThrow(
      /No project mapping for tenant "leads"/
    )
  })
})
