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
 *
 * Every list screen also declares its KIND (Tom, 2026-10-18 — "not a card one
 * time and a list the other time"):
 *   content — things the site publishes (Posts, Catalogue, Galleries, Events,
 *             later News, Live): ListToolbar + DataTable + ContentCard grid +
 *             ViewSwitch list ⇄ cards, list by default, remembered per person
 *             (useViewPreference).
 *   library — picture libraries (Media, later Brand Hub assets): ListToolbar +
 *             ViewSwitch grid ⇄ list (DataTable), grid by default, no ContentCard.
 *   records — records and settings without pictures (Contact requests, People,
 *             Categories & tags, admin lists): ListToolbar + DataTable on
 *             computers + ListRow on phones, never cards, no ViewSwitch.
 * A screen that is not declared fails, and so does one that mixes kinds.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DIRS = ['src/components/client', 'src/components/admin']

/** List screens that predate the *Browser naming. */
const LEGACY_NAMES = new Set([
  'src/components/client/gallery/GalleryList.tsx',
  'src/components/client/media/MediaLibraryScreen.tsx',
  'src/components/client/events/EventList.tsx',
  'src/components/client/taxonomy/TaxonomyManager.tsx',
  'src/components/admin/whats-new/WhatsNewAdmin.tsx',
])

type Kind = 'content' | 'library' | 'records'
/** Every list screen and its kind, with the reason. */
const KIND: Record<string, [Kind, string]> = {
  'src/components/client/posts/PostsBrowser.tsx': ['content', 'posts the site publishes, with a cover'],
  'src/components/client/catalogue/CatalogueBrowser.tsx': ['content', 'items, collections and option lists the site publishes'],
  'src/components/client/gallery/GalleryList.tsx': ['content', 'galleries the site publishes, with photos'],
  'src/components/client/events/EventList.tsx': ['content', 'events the site publishes, with a photo'],
  'src/components/client/media/MediaLibraryScreen.tsx': ['library', 'the picture library: grid first'],
  'src/components/client/forms/SubmissionsBrowser.tsx': ['records', 'contact requests: no pictures'],
  'src/components/client/people/PeopleBrowser.tsx': ['records', 'people with access: no pictures'],
  'src/components/client/taxonomy/TaxonomyManager.tsx': ['records', 'categories and tags: short names, no pictures'],
  'src/components/admin/projects/ProjectsBrowser.tsx': ['records', 'admin list of projects'],
  'src/components/admin/backlog/BacklogBrowser.tsx': ['records', 'admin backlog'],
  'src/components/admin/analytics/PortfolioBrowser.tsx': ['records', 'admin analytics per site'],
  'src/components/admin/partners/PartnersBrowser.tsx': ['records', 'admin partner apps'],
  'src/components/admin/whats-new/WhatsNewAdmin.tsx': ['records', 'admin update notes'],
}

/** Declared, but not yet built exactly to their kind — may only shrink. */
const KIND_PENDING: Record<string, string> = {
}

/** Not yet on the shared parts — the migration list. Remove a line when its screen is moved over. */
const PENDING: Record<string, string> = {
}

/**
 * Screens named *Browser that are not browsable collections, with the reason.
 * They still use shared components (the ban check covers them); they just do
 * not need search and filters.
 */
const NOT_A_COLLECTION: Record<string, string> = {
  'src/components/client/connections/ConnectedAppsBrowser.tsx': 'A short settings list (usually 0–3 connected apps), shown as Panels — nothing to search or filter.',
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

/** What a screen lacks (or has too much of) for its kind; [] = built exactly to it. */
function kindProblems(rel: string, kind: Kind): string[] {
  const all = reachableSpecs(path.join(ROOT, rel))
  const has = {
    toolbar: /@\/components\/app\/ui\/ListToolbar['"]/.test(all),
    table: /@\/components\/app\/ui\/list\/DataTable['"]/.test(all),
    cards: /<(?:ContentCard|CardGrid)\b/.test(all),
    viewSwitch: /@\/components\/app\/ui\/ViewSwitch['"]/.test(all),
    remembered: /useViewPreference\b/.test(all),
    listRow: /<ListRow\b/.test(all),
    listFirst: /useViewPreference[^;\n]*'list'\)/.test(all),
    gridFirst: /useViewPreference[^;\n]*'grid'\)/.test(all),
  }
  const need: Record<Kind, Partial<Record<keyof typeof has, boolean>>> = {
    content: { toolbar: true, table: true, cards: true, viewSwitch: true, remembered: true, listFirst: true },
    library: { toolbar: true, table: true, cards: false, viewSwitch: true, remembered: true, gridFirst: true },
    records: { toolbar: true, table: true, listRow: true, cards: false, viewSwitch: false },
  }
  return Object.entries(need[kind])
    .filter(([k, want]) => has[k as keyof typeof has] !== want)
    .map(([k, want]) => (want ? `missing ${k}` : `must not use ${k}`))
}

const screens = DIRS.flatMap((d) => files(path.join(ROOT, d)))
  .map((f) => path.relative(ROOT, f))
  .filter((f) => f.endsWith('Browser.tsx') || LEGACY_NAMES.has(f))

describe('list screens use the shared list parts', () => {
  it('finds the list screens', () => {
    expect(screens.length).toBeGreaterThan(8)
  })
  for (const rel of screens.filter((s) => !PENDING[s] && !NOT_A_COLLECTION[s])) {
    it(`${rel} uses ListToolbar and DataTable or ContentCard`, () => {
      const all = reachableSpecs(path.join(ROOT, rel))
      expect(all, 'ListToolbar').toMatch(/@\/components\/app\/ui\/ListToolbar['"]/)
      expect(all, 'DataTable or ContentCard').toMatch(/@\/components\/app\/ui\/list\/(?:DataTable|ContentCard)['"]/)
    })
  }
  it('every list screen declares its kind (content | library | records)', () => {
    const undeclared = screens.filter((s) => !NOT_A_COLLECTION[s] && !KIND[s])
    expect(undeclared).toEqual([])
    for (const rel of Object.keys(KIND)) expect(screens, rel).toContain(rel)
  })
  for (const rel of screens.filter((s) => KIND[s] && !KIND_PENDING[s])) {
    const [kind] = KIND[rel]
    it(`${rel} is built exactly as a ${kind} screen`, () => {
      const missing = kindProblems(rel, kind)
      expect(missing).toEqual([])
    })
  }
  it('KIND_PENDING lists only screens that still differ from their kind (remove a line when done)', () => {
    for (const rel of Object.keys(KIND_PENDING)) {
      expect(KIND[rel], rel).toBeDefined()
      expect(kindProblems(rel, KIND[rel][0]).length, `${rel} is already built to its kind — remove it from KIND_PENDING`).toBeGreaterThan(0)
    }
  })
  it('PENDING lists only real list screens that still need moving (remove a line when done)', () => {
    for (const rel of Object.keys(PENDING)) {
      expect(screens, rel).toContain(rel)
      const all = reachableSpecs(path.join(ROOT, rel))
      const done = /ui\/ListToolbar['"]/.test(all) && /ui\/list\/(?:DataTable|ContentCard)['"]/.test(all)
      expect(done, `${rel} already uses the shared parts — remove it from PENDING`).toBe(false)
    }
  })
})
