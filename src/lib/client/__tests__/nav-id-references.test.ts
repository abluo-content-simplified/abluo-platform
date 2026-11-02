/**
 * Every nav id the dashboard links to by name must exist in `TENANT_SURFACES`.
 * `navHref` returns null for an unknown id (fail closed), so a renamed nav id
 * silently turns a link off — this test turns that into a build failure.
 * (R1 review: Home linked `catalogue` after the id became `catalogueItems`.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { navHref } from '../home-cards'
import { TENANT_SURFACES } from '../surfaces'

const ROOT = process.cwd()
const SCAN_DIRS = ['src/app/[locale]/(client)', 'src/components/client', 'src/lib/client']

function walk(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    const full = path.join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** `link('x'` (Home's registry-bound helper) and `navHref(slug, 'x'`. */
const REFERENCE = /\b(?:link\(\s*|navHref\(\s*[^,()]+,\s*)['"`]([A-Za-z0-9_.-]+)['"`]/g

function referencedNavIds(): { file: string; id: string }[] {
  return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((file) => {
    const src = readFileSync(file, 'utf8')
    return [...src.matchAll(REFERENCE)].map((m) => ({ file: path.relative(ROOT, file), id: m[1] }))
  })
}

const NAV_IDS = new Set(TENANT_SURFACES.filter((s) => s.kind === 'nav').map((s) => s.id))

describe('dashboard nav id references', () => {
  it('finds the references (the scan is not vacuous)', () => {
    const ids = referencedNavIds().map((r) => r.id)
    expect(ids).toContain('catalogueItems')
    expect(ids).toContain('blog')
    expect(ids.length).toBeGreaterThan(10)
  })

  it('every referenced nav id is registered in TENANT_SURFACES', () => {
    const unknown = referencedNavIds().filter((r) => !NAV_IDS.has(r.id))
    expect(unknown).toEqual([])
  })

  it('navHref fails closed on an unknown id', () => {
    expect(navHref('p', 'catalogue', TENANT_SURFACES)).toBeNull()
    expect(navHref('p', 'catalogueItems', TENANT_SURFACES)).toBe('/p/catalogue/items')
  })
})
