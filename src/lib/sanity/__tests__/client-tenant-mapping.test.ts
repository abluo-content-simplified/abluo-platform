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
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

describe('tryTenantToProjectSlug', () => {
  it('resolves a mapped tenant slug to its Sanity projectSlug', () => {
    expect(tryTenantToProjectSlug(asUrlProjectSegment('livener'))).toBe('livener-main')
    expect(tryTenantToProjectSlug(asUrlProjectSegment('studiomartegani'))).toBe('studiomartegani-main')
  })

  it('returns null (never throws) for an unmapped tenant slug', () => {
    expect(tryTenantToProjectSlug(asUrlProjectSegment('leads'))).toBeNull()
    expect(tryTenantToProjectSlug(asUrlProjectSegment('some-typo'))).toBeNull()
    expect(tryTenantToProjectSlug(asUrlProjectSegment(''))).toBeNull()
  })
})

describe('tenantToProjectSlug', () => {
  it('resolves a mapped tenant slug to its Sanity projectSlug', () => {
    expect(tenantToProjectSlug(asUrlProjectSegment('livener'))).toBe('livener-main')
  })

  it('still throws for an unmapped tenant slug — internal/admin callers rely on this', () => {
    expect(() => tenantToProjectSlug(asUrlProjectSegment('leads'))).toThrow(
      /No project mapping for tenant "leads"/
    )
  })
})
