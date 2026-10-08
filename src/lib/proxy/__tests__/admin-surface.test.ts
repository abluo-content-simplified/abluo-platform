/**
 * The admin allowlist is in lockstep with the `(admin)` route folders (ADR-030).
 *
 * Every admin page reads with the service role; the proxy gate is keyed on
 * `ADMIN_SURFACE_SEGMENTS`. A page added without its segment would be served by
 * the layout gate alone, and a segment left behind after a page is removed
 * would reserve a path for nothing — so the directory is read at test time and
 * the two must agree in both directions (as client-surface.test.ts does for
 * the client dashboard).
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_SURFACE_SEGMENTS,
  RETIRED_ADMIN_SEGMENTS,
  isAdminSurface,
  retiredAdminRedirect,
} from '../admin-surface'

const ADMIN_DIR = path.join(process.cwd(), 'src/app/[locale]/(admin)')
const folders = readdirSync(ADMIN_DIR).filter((name) => statSync(path.join(ADMIN_DIR, name)).isDirectory())

describe('ADMIN_SURFACE_SEGMENTS ↔ src/app/[locale]/(admin)', () => {
  it('every admin route folder is a gated segment', () => {
    expect(folders.filter((f) => !ADMIN_SURFACE_SEGMENTS.has(f))).toEqual([])
  })

  it('every gated segment has a route folder', () => {
    expect([...ADMIN_SURFACE_SEGMENTS].filter((s) => !folders.includes(s))).toEqual([])
  })

  it('a retired segment has no route folder and is not also live', () => {
    for (const seg of RETIRED_ADMIN_SEGMENTS) {
      expect(folders).not.toContain(seg)
      expect(ADMIN_SURFACE_SEGMENTS.has(seg)).toBe(false)
    }
  })
})

describe('retired admin pages', () => {
  it('stay admin surfaces (gated)', () => {
    for (const seg of RETIRED_ADMIN_SEGMENTS) expect(isAdminSurface(`/${seg}`)).toBe(true)
  })

  it('redirect to Home, keeping the locale prefix', () => {
    expect(retiredAdminRedirect('/clients')).toBe('/dashboard')
    expect(retiredAdminRedirect('/settings/anything')).toBe('/dashboard')
    expect(retiredAdminRedirect('/en/content')).toBe('/en/dashboard')
    expect(retiredAdminRedirect('/it/clients/x')).toBe('/it/dashboard')
  })

  it('leave every other path alone', () => {
    for (const p of ['/dashboard', '/en/projects', '/en/livener/settings', '/account', '/', '/en']) {
      expect(retiredAdminRedirect(p)).toBeNull()
    }
  })
})
