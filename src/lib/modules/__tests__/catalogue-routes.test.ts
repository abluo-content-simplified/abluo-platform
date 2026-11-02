/**
 * `/catalogue` redirects to Catalogue → Items (ADR-042 N2a); old `?view=` deep
 * links keep working.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogueRedirectTarget } from '../catalogue-routes'

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
