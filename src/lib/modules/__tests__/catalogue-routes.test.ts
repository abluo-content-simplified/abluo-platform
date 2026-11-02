/**
 * `/catalogue` redirects to Catalogue → Items (ADR-042 N2a); old `?view=` deep
 * links keep working.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogueListPath, catalogueListSearch, catalogueRedirectTarget } from '../catalogue-routes'

const ROUTES = path.join(process.cwd(), 'src/app/[locale]/(client)/[tenant]/catalogue')

describe('catalogueRedirectTarget', () => {
  it('goes to Items by default', () => {
    expect(catalogueRedirectTarget('tmz', {})).toBe('/tmz/catalogue/items')
  })
  it('maps the former view switch to the new routes', () => {
    expect(catalogueRedirectTarget('tmz', { view: 'items' })).toBe('/tmz/catalogue/items')
    expect(catalogueRedirectTarget('tmz', { view: 'collections' })).toBe('/tmz/catalogue/collections')
    expect(catalogueRedirectTarget('tmz', { view: 'optionLists' })).toBe('/tmz/catalogue/option-lists')
  })
  it('ignores unknown views and carries only status and sort', () => {
    expect(catalogueRedirectTarget('tmz', { view: '__proto__' })).toBe('/tmz/catalogue/items')
    expect(catalogueRedirectTarget('tmz', { view: 'collections', status: 'draft', sort: 'name:desc', evil: 'x' })).toBe('/tmz/catalogue/collections?status=draft&sort=name%3Adesc')
  })
})

describe('catalogue routes', () => {
  it('each destination is a real route and /catalogue is only a redirect', () => {
    for (const r of ['items', 'collections', 'option-lists']) expect(existsSync(path.join(ROUTES, r, 'page.tsx')), r).toBe(true)
    expect(readFileSync(path.join(ROUTES, 'page.tsx'), 'utf8')).toMatch(/redirect\(catalogueRedirectTarget/)
  })
  it('the list screen has no segmented Items / Collections / Option lists tabs any more (ADR-042 N1 / K-1)', () => {
    const browser = readFileSync(path.join(process.cwd(), 'src/components/client/catalogue/CatalogueBrowser.tsx'), 'utf8')
    expect(browser).not.toMatch(/SegmentedControl/)
  })
})

describe('R1 review: back links and list URL sync use the routes, never ?view=', () => {
  it('catalogueListPath points at each list route', () => {
    expect(catalogueListPath('p', 'items')).toBe('/p/catalogue/items')
    expect(catalogueListPath('p', 'collections')).toBe('/p/catalogue/collections')
    expect(catalogueListPath('p', 'optionLists')).toBe('/p/catalogue/option-lists')
  })

  it('catalogueListSearch syncs status and sort, drops defaults and a stale view', () => {
    expect(catalogueListSearch('', 'all', null)).toBe('')
    expect(catalogueListSearch('?view=collections&status=draft', 'published', 'updated:desc')).toBe('?status=published&sort=updated%3Adesc')
    expect(catalogueListSearch('?status=draft&sort=name:desc&x=1', 'all', null)).toBe('?x=1')
  })

  it('no editor back link and no list screen writes ?view=', () => {
    for (const f of ['collections/new/page.tsx', 'collections/[id]/page.tsx', 'option-lists/new/page.tsx', 'option-lists/[id]/page.tsx']) {
      const src = readFileSync(path.join(ROUTES, f), 'utf8')
      expect(src, f).not.toMatch(/\?view=/)
      expect(src, f).toMatch(/listHref=\{catalogueListPath\(projectSlug, '(collections|optionLists)'\)\}/)
    }
    const browser = readFileSync(path.join(process.cwd(), 'src/components/client/catalogue/CatalogueBrowser.tsx'), 'utf8')
    expect(browser).not.toMatch(/searchParams\.set\(\s*'view'/)
    expect(browser).toMatch(/catalogueListSearch\(/)
  })
})
