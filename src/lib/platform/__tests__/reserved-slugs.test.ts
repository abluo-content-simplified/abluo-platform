/**
 * RESERVED_SLUGS must cover every static route segment a slug could collide
 * with. The directory is read at test time: adding a top-level page
 * (`src/app/[locale]/(admin)/billing`) or a tenant-level page
 * (`src/app/[locale]/(client)/[tenant]/forms`) without reserving its segment
 * fails here.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { ADMIN_SURFACE_SEGMENTS, RETIRED_ADMIN_SEGMENTS } from '@/lib/proxy/admin-surface'
import { RESERVED_SLUGS, isReservedSlug } from '../reserved-slugs'

const APP_DIR = path.join(process.cwd(), 'src/app')

type Level = 'top' | 'tenant'

/**
 * Static segments at the top level (after the optional locale prefix) and at
 * the tenant level (directly under a `[tenant]` folder). Route groups `(x)`
 * are transparent; `[locale]` is an optional prefix, so its children are still
 * top level; `[tenant]` moves one level down; other dynamic folders stop.
 */
function collectSegments(dir: string, level: Level, out: Record<Level, Set<string>>) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory() || name === '__tests__') continue
    if (name.startsWith('(') && name.endsWith(')')) {
      collectSegments(full, level, out)
    } else if (name === '[locale]' && level === 'top') {
      collectSegments(full, 'top', out)
    } else if (name === '[tenant]' && level === 'top') {
      collectSegments(full, 'tenant', out)
    } else if (name.startsWith('[')) {
      continue
    } else {
      out[level].add(name)
    }
  }
}

const segments: Record<Level, Set<string>> = { top: new Set(), tenant: new Set() }
collectSegments(APP_DIR, 'top', segments)

describe('RESERVED_SLUGS ↔ src/app', () => {
  it('finds the route tree (sanity check on the walker)', () => {
    expect(segments.top.has('api')).toBe(true)
    expect(segments.top.has('dashboard')).toBe(true)
    expect(segments.tenant.has('posts')).toBe(true)
  })

  it('reserves every top-level static segment', () => {
    expect([...segments.top].filter((s) => !isReservedSlug(s))).toEqual([])
  })

  it('reserves every tenant-level static segment', () => {
    expect([...segments.tenant].filter((s) => !isReservedSlug(s))).toEqual([])
  })

  it('reserves every admin segment, live and retired', () => {
    const admin = [...ADMIN_SURFACE_SEGMENTS, ...RETIRED_ADMIN_SEGMENTS]
    expect(admin.filter((s) => !isReservedSlug(s))).toEqual([])
  })

  it('reserves every interface locale (the optional URL prefix)', () => {
    expect(LOCALE_CODES.filter((c) => !isReservedSlug(c))).toEqual([])
  })

  it('is lowercase and has no duplicates', () => {
    expect(RESERVED_SLUGS.every((s) => s === s.toLowerCase())).toBe(true)
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length)
  })
})

describe('isReservedSlug', () => {
  it('matches case- and whitespace-insensitively', () => {
    expect(isReservedSlug('analytics')).toBe(true)
    expect(isReservedSlug(' Studio ')).toBe(true)
    expect(isReservedSlug('WHATS-NEW')).toBe(true)
  })

  it('reserves framework and dot-file prefixes', () => {
    expect(isReservedSlug('_next')).toBe(true)
    expect(isReservedSlug('_anything')).toBe(true)
    expect(isReservedSlug('.well-known')).toBe(true)
  })

  it('leaves ordinary and empty slugs alone', () => {
    expect(isReservedSlug('')).toBe(false)
    expect(isReservedSlug('analytics-studio')).toBe(false)
    expect(isReservedSlug('my-posts')).toBe(false)
  })

  it('none of the live tenant or project slugs is reserved (2026-10-08 dataset)', () => {
    const live = ['abluo', 'amelie', 'cyce', 'freeriders', 'hoffmann', 'livener', 'nologo', 'studiomartegani', 'tmz']
    expect(live.filter(isReservedSlug)).toEqual([])
  })
})
