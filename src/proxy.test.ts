import { describe, it, expect } from 'vitest'
import { isAdminSurface, isStudio } from '@/lib/proxy/admin-surface'

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
