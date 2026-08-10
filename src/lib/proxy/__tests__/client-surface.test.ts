import { describe, it, expect } from 'vitest'
import {
  isClientSurface,
  CLIENT_USER_SEGMENTS,
  CLIENT_PROJECT_SEGMENTS,
} from '../client-surface'
import { ADMIN_SURFACE_SEGMENTS, isAdminSurface } from '../admin-surface'

describe('isClientSurface', () => {
  it('matches user-level segments at the root (no locale prefix)', () => {
    for (const seg of CLIENT_USER_SEGMENTS) {
      expect(isClientSurface(`/${seg}`)).toBe(true)
    }
  })

  it('matches user-level segments behind a locale prefix', () => {
    for (const seg of CLIENT_USER_SEGMENTS) {
      expect(isClientSurface(`/en/${seg}`)).toBe(true)
      expect(isClientSurface(`/it/${seg}`)).toBe(true)
      expect(isClientSurface(`/de/${seg}`)).toBe(true)
    }
  })

  it('matches project-scoped routes: /{projectSlug}/{segment}', () => {
    for (const seg of CLIENT_PROJECT_SEGMENTS) {
      expect(isClientSurface(`/livener-main/${seg}`)).toBe(true)
      expect(isClientSurface(`/en/livener-main/${seg}`)).toBe(true)
      expect(isClientSurface(`/de/studiomartegani-main/${seg}`)).toBe(true)
    }
  })

  it('matches deeper paths under a project-scoped segment', () => {
    expect(isClientSurface('/en/livener-main/posts/123')).toBe(true)
    expect(isClientSurface('/livener-main/leads/new')).toBe(true)
  })

  it('does NOT match a bare project slug with no client sub-page', () => {
    // /{projectSlug} alone is not a client surface — it is a public tenant root.
    expect(isClientSurface('/en/livener-main')).toBe(false)
    expect(isClientSurface('/livener-main')).toBe(false)
  })

  it('does NOT match a project path whose sub-page is not a client segment', () => {
    // Public tenant sub-routes (blog/events/live/free slugs) must not be gated.
    expect(isClientSurface('/en/livener/about')).toBe(false)
    expect(isClientSurface('/en/livener/events')).toBe(false)
    expect(isClientSurface('/en/livener/blog')).toBe(false)
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

  it('user and admin allowlists are disjoint — no segment is both', () => {
    for (const seg of CLIENT_USER_SEGMENTS) {
      expect(ADMIN_SURFACE_SEGMENTS.has(seg)).toBe(false)
    }
    for (const seg of ADMIN_SURFACE_SEGMENTS) {
      // A single admin segment is not a client surface, and IS an admin surface.
      expect(isClientSurface(`/en/${seg}`)).toBe(false)
      expect(isAdminSurface(`/en/${seg}`)).toBe(true)
    }
  })

  it('project and admin sub-page segment sets are disjoint', () => {
    for (const seg of CLIENT_PROJECT_SEGMENTS) {
      expect(ADMIN_SURFACE_SEGMENTS.has(seg)).toBe(false)
    }
  })
})
