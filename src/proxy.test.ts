import { describe, it, expect } from 'vitest'
import { isAdminSurface, isStudio, isPreAuthSurface } from '@/lib/proxy/admin-surface'

/**
 * Unit coverage for the two pure path predicates that decide whether the
 * admin-surface gate (ADR-015 R6) fires. The gate itself is an HTTP-boundary
 * concern (cookies, getUser, redirects) and is exercised by Tom's localhost
 * verification plan — not mocked here. These tests pin the classification
 * logic: which paths are admin surfaces, which are Studio, and that locale
 * prefixes are stripped before matching.
 */

describe('isAdminSurface', () => {
  it('matches every admin surface segment (locale-prefixed)', () => {
    for (const seg of ['dashboard', 'clients', 'content', 'media', 'projects', 'settings']) {
      expect(isAdminSurface(`/en/${seg}`)).toBe(true)
    }
  })

  it('matches admin surfaces without a locale prefix', () => {
    expect(isAdminSurface('/dashboard')).toBe(true)
    expect(isAdminSurface('/settings')).toBe(true)
  })

  it('matches nested admin-surface paths', () => {
    expect(isAdminSurface('/en/dashboard/anything/deep')).toBe(true)
    expect(isAdminSurface('/media/some-asset')).toBe(true)
  })

  it('strips any 2-letter locale prefix before matching', () => {
    expect(isAdminSurface('/it/settings')).toBe(true)
    expect(isAdminSurface('/de/dashboard')).toBe(true)
    expect(isAdminSurface('/fr/media')).toBe(true)
  })

  it('does NOT match the escape-hatch pages', () => {
    expect(isAdminSurface('/unauthorized')).toBe(false)
    expect(isAdminSurface('/en/unauthorized')).toBe(false)
    expect(isAdminSurface('/login')).toBe(false)
    expect(isAdminSurface('/en/login')).toBe(false)
  })

  it('does NOT match Studio (that is isStudio, a separate predicate)', () => {
    expect(isAdminSurface('/studio')).toBe(false)
    expect(isAdminSurface('/studio/structure')).toBe(false)
  })

  it('does NOT match tenant-ish or root paths', () => {
    expect(isAdminSurface('/')).toBe(false)
    expect(isAdminSurface('/en')).toBe(false)
    expect(isAdminSurface('/en/livener')).toBe(false)
    expect(isAdminSurface('/en/studiomartegani/blog')).toBe(false)
    // A tenant page that merely contains an admin word deeper in the path.
    expect(isAdminSurface('/en/livener/settings')).toBe(false)
  })
})

describe('isStudio', () => {
  it('matches the Studio root and everything beneath it', () => {
    expect(isStudio('/studio')).toBe(true)
    expect(isStudio('/studio/')).toBe(true)
    expect(isStudio('/studio/structure')).toBe(true)
    expect(isStudio('/studio/desk/post')).toBe(true)
  })

  it('does NOT match locale-prefixed or look-alike paths', () => {
    // Studio is never locale-prefixed (it lives outside [locale]).
    expect(isStudio('/en/studio')).toBe(false)
    expect(isStudio('/studious')).toBe(false)
    expect(isStudio('/dashboard')).toBe(false)
    expect(isStudio('/')).toBe(false)
  })
})

describe('isPreAuthSurface', () => {
  // These pages are where someone goes precisely when they cannot
  // authenticate. Each sits outside [locale], so omitting one means
  // intlMiddleware rewrites it to /en/... and it 404s — a failure that reads
  // like a broken route rather than a middleware list someone forgot to update.

  it('covers every pre-authentication page', () => {
    for (const path of [
      '/login',
      '/unauthorized',
      '/auth/callback',
      '/invite/accept',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(isPreAuthSurface(path), path).toBe(true)
    }
  })

  it('covers sub-paths and query-bearing variants', () => {
    expect(isPreAuthSurface('/invite/accept/abc123')).toBe(true)
    expect(isPreAuthSurface('/auth/callback/supabase')).toBe(true)
  })

  it('does not match a locale-prefixed variant', () => {
    // If one of these ever appears under a locale it means the rewrite already
    // happened, which is the bug this list prevents.
    expect(isPreAuthSurface('/en/login')).toBe(false)
    expect(isPreAuthSurface('/it/reset-password')).toBe(false)
  })

  it('does not match unrelated paths that merely share a prefix', () => {
    expect(isPreAuthSurface('/logins')).toBe(false)
    expect(isPreAuthSurface('/reset-password-admin')).toBe(false)
    expect(isPreAuthSurface('/en/dashboard')).toBe(false)
    expect(isPreAuthSurface('/')).toBe(false)
  })
})
