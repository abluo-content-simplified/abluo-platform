/**
 * Guard: every list screen is built from the same parts (Tom, 2026-10-17) —
 * the shared ListToolbar (search, filters, date range) above a DataTable
 * and/or ContentCard grid. A new list screen therefore looks and behaves like
 * Posts or Media without anyone having to say so.
 *
 * A list screen is a component named `*Browser.tsx` under
 * src/components/client or src/components/admin (the convention), plus the
 * older names in LEGACY_NAMES. The check follows the screen's own local
 * imports two levels deep (e.g. PostsBrowser → PostsFilters → ListToolbar).
 * Screens not yet moved over are in PENDING, which may only shrink.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DIRS = ['src/components/client', 'src/components/admin']

/** List screens that predate the *Browser naming. */
const LEGACY_NAMES = new Set(['src/components/client/gallery/GalleryList.tsx', 'src/components/client/media/MediaLibraryScreen.tsx', 'src/components/client/events/EventList.tsx', 'src/components/admin/whats-new/WhatsNewAdmin.tsx'])

/** Not yet on the shared parts — the migration list. Remove a line when its screen is moved over. */
const PENDING: Record<string, string> = {
  'src/components/client/catalogue/CatalogueBrowser.tsx': 'own segmented filters — move to ListToolbar',
  'src/components/client/events/EventList.tsx': 'own list — move to ListToolbar + DataTable/ContentCard',
  'src/components/admin/partners/PartnersBrowser.tsx': 'own list — move to ListToolbar + DataTable',
  'src/components/client/connections/ConnectedAppsBrowser.tsx': 'own list — move to DataTable/ContentCard (toolbar if it grows)',
  'src/components/admin/whats-new/WhatsNewAdmin.tsx': 'DataTable without ListToolbar',
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full)
    return /\.tsx$/.test(name) ? [full] : []
  })
}

function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    let base: string | null = null
    if (spec.startsWith('.')) base = path.resolve(path.dirname(file), spec)
    else if (spec.startsWith('@/components/client/') || spec.startsWith('@/components/admin/')) base = path.join(ROOT, 'src', spec.slice(2))
    if (!base) continue
    for (const cand of [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.ts')]) if (existsSync(cand)) out.push(cand)
  }
  return out
}

/** All module specifiers reachable from the screen within two local hops. */
function reachableSpecs(file: string): string {
  const seen = new Set([file])
  let frontier = [file]
  for (let depth = 0; depth < 2; depth++) {
    frontier = frontier.flatMap(localImports).filter((f) => !seen.has(f) && (seen.add(f), true))
  }
  return [...seen].map((f) => readFileSync(f, 'utf8')).join('\n')
}

const screens = DIRS.flatMap((d) => files(path.join(ROOT, d)))
  .map((f) => path.relative(ROOT, f))
  .filter((f) => f.endsWith('Browser.tsx') || LEGACY_NAMES.has(f))

describe('list screens use the shared list parts', () => {
  it('finds the list screens', () => {
    expect(screens.length).toBeGreaterThan(8)
  })
  for (const rel of screens.filter((s) => !PENDING[s])) {
    it(`${rel} uses ListToolbar and DataTable or ContentCard`, () => {
      const all = reachableSpecs(path.join(ROOT, rel))
      expect(all, 'ListToolbar').toMatch(/@\/components\/app\/ui\/ListToolbar['"]/)
      expect(all, 'DataTable or ContentCard').toMatch(/@\/components\/app\/ui\/list\/(?:DataTable|ContentCard)['"]/)
    })
  }
  it('PENDING lists only real list screens that still need moving (remove a line when done)', () => {
    for (const rel of Object.keys(PENDING)) {
      expect(screens, rel).toContain(rel)
      const all = reachableSpecs(path.join(ROOT, rel))
      const done = /ui\/ListToolbar['"]/.test(all) && /ui\/list\/(?:DataTable|ContentCard)['"]/.test(all)
      expect(done, `${rel} already uses the shared parts — remove it from PENDING`).toBe(false)
    }
  })
})
