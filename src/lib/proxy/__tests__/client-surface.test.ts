import { describe, it, expect } from 'vitest'
import { isClientSurface, CLIENT_SURFACE_SEGMENTS } from '../client-surface'
import { ADMIN_SURFACE_SEGMENTS, isAdminSurface } from '../admin-surface'

describe('isClientSurface', () => {
  it('matches each client segment at the root (no locale prefix)', () => {
    for (const seg of CLIENT_SURFACE_SEGMENTS) {
      expect(isClientSurface(`/${seg}`)).toBe(true)
    }
  })

  it('matches each client segment behind a locale prefix', () => {
    for (const seg of CLIENT_SURFACE_SEGMENTS) {
      expect(isClientSurface(`/en/${seg}`)).toBe(true)
      expect(isClientSurface(`/it/${seg}`)).toBe(true)
      expect(isClientSurface(`/de/${seg}`)).toBe(true)
    }
  })

  it('matches deeper paths under a client segment', () => {
    expect(isClientSurface('/en/posts/123')).toBe(true)
    expect(isClientSurface('/posts/new')).toBe(true)
  })

  it('does NOT match admin surfaces', () => {
    expect(isClientSurface('/en/dashboard')).toBe(false)
    expect(isClientSurface('/dashboard')).toBe(false)
    expect(isClientSurface('/en/clients')).toBe(false)
    expect(isClientSurface('/settings')).toBe(false)
  })

  it('does NOT match auth escape-hatch or root paths', () => {
    expect(isClientSurface('/login')).toBe(false)
    expect(isClientSurface('/unauthorized')).toBe(false)
    expect(isClientSurface('/')).toBe(false)
    expect(isClientSurface('/en')).toBe(false)
  })

  it('does NOT match a tenant public path that happens to share a locale prefix', () => {
    // A tenant public page like /en/livener/about — leading segment is the
    // tenant slug, not a client surface.
    expect(isClientSurface('/en/livener/about')).toBe(false)
  })

  it('client and admin allowlists are disjoint — no segment is both', () => {
    for (const seg of CLIENT_SURFACE_SEGMENTS) {
      expect(ADMIN_SURFACE_SEGMENTS.has(seg)).toBe(false)
    }
    for (const seg of ADMIN_SURFACE_SEGMENTS) {
      expect(isClientSurface(`/en/${seg}`)).toBe(false)
      expect(isAdminSurface(`/en/${seg}`)).toBe(true)
    }
  })
})
