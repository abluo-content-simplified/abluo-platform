import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// ─── Anti-drift: the allowlist vs. the filesystem ────────────────────────────
//
// `CLIENT_PROJECT_SEGMENTS` claims to be "kept in lockstep with
// `src/app/[locale]/(client)/[tenant]/*`". It was not: `submissions` shipped as
// a route without being listed, so the middleware gate never fired for it and
// the path fell through to the project-slug rewrite instead. (Not an access
// hole — `(client)/[tenant]/layout.tsx` redirects anonymous users to /login and
// notFound()s a missing grant, and `submissions/page.tsx` repeats the grant
// check — but the wrong routing path.)
//
// A comment cannot enforce lockstep, so this reads the real directory at test
// time. It fails the day a sixth page is added and not listed, and the day a
// listed segment's directory is deleted or renamed.

const CLIENT_TENANT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../app/[locale]/(client)/[tenant]'
)

/** True when `dir` (or anything beneath it) declares a route. */
function containsRoute(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && /^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) return true
    if (entry.isDirectory() && containsRoute(join(dir, entry.name))) return true
  }
  return false
}

/**
 * The literal URL segments directly under `(client)/[tenant]/`.
 *
 * Skips files (`layout.tsx`), private folders (`_components`), route groups
 * (`(group)` — not URL segments) and parallel/dynamic segments (`@slot`,
 * `[id]` — not literal names the allowlist could hold), and requires the
 * directory to actually declare a route somewhere beneath it.
 */
function routeSegmentsOnDisk(): string[] {
  return readdirSync(CLIENT_TENANT_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !/^[_([@.]/.test(name))
    .filter((name) => containsRoute(join(CLIENT_TENANT_DIR, name)))
    .sort()
}

describe('CLIENT_PROJECT_SEGMENTS is in lockstep with the filesystem', () => {
  it('finds the route directory at all (guards against a vacuously green test)', () => {
    expect(existsSync(CLIENT_TENANT_DIR)).toBe(true)
    expect(routeSegmentsOnDisk().length).toBeGreaterThan(0)
  })

  it('lists every project-scoped client page that exists on disk', () => {
    const missing = routeSegmentsOnDisk().filter((s) => !CLIENT_PROJECT_SEGMENTS.has(s))
    expect(
      missing,
      `Route(s) under (client)/[tenant]/ are not gated. Add to CLIENT_PROJECT_SEGMENTS: ${missing.join(', ')}`
    ).toEqual([])
  })

  it('lists nothing that no longer exists on disk', () => {
    // The other drift direction: a renamed or deleted page leaves a dead
    // allowlist entry that shadows a public tenant sub-route of the same name.
    const onDisk = new Set(routeSegmentsOnDisk())
    const stale = [...CLIENT_PROJECT_SEGMENTS].filter((s) => !onDisk.has(s))
    expect(
      stale,
      `CLIENT_PROJECT_SEGMENTS names route(s) that do not exist: ${stale.join(', ')}`
    ).toEqual([])
  })

  it('gates the submissions page', () => {
    // The instance the drift check was written for.
    expect(CLIENT_PROJECT_SEGMENTS.has('submissions')).toBe(true)
    expect(isClientSurface('/nologo/submissions')).toBe(true)
    expect(isClientSurface('/en/nologo/submissions')).toBe(true)
    // Still not a leading-segment surface, and still not an admin one.
    expect(isClientSurface('/submissions')).toBe(false)
    expect(isAdminSurface('/en/submissions')).toBe(false)
  })
})
