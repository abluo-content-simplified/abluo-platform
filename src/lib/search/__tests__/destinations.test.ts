import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TENANT_SURFACES } from '@/lib/client/surfaces'
import { availableSubDestinations, SUB_DESTINATIONS, type SubDestination } from '../destinations'

const ROUTES = path.join(process.cwd(), 'src/app/[locale]/(client)/[tenant]')
const NAV_IDS = new Set(TENANT_SURFACES.filter((s) => s.kind === 'nav').map((s) => s.id))

describe('SUB_DESTINATIONS', () => {
  it('is not empty and ids are unique kebab-case', () => {
    expect(SUB_DESTINATIONS.length).toBeGreaterThan(0)
    const ids = SUB_DESTINATIONS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('every parent is a real navigation item id', () => {
    for (const d of SUB_DESTINATIONS) expect(NAV_IDS.has(d.parent), `${d.id} → ${d.parent}`).toBe(true)
  })

  it('every href is under the project and points at an existing route folder', () => {
    for (const d of SUB_DESTINATIONS) {
      const href = d.href('my-site')
      expect(href.startsWith('/my-site/'), d.id).toBe(true)
      const route = href.slice('/my-site/'.length).split(/[?#]/)[0]
      expect(fs.existsSync(path.join(ROUTES, route, 'page.tsx')), `${d.id} → ${route}`).toBe(true)
    }
  })

  it('does not point at admin or studio surfaces', () => {
    for (const d of SUB_DESTINATIONS) expect(d.href('x')).not.toMatch(/\/(studio|admin)(\/|$)/)
  })
})

describe('availableSubDestinations', () => {
  const all: SubDestination[] = [
    { id: 'a', parent: 'settings', href: (s) => `/${s}/settings` },
    { id: 'b', parent: 'settings', href: (s) => `/${s}/settings`, permission: 'p.x' },
    { id: 'c', parent: 'media', href: (s) => `/${s}/media` },
  ]
  const ids = (parents: string[], perms: string[]) => availableSubDestinations(new Set(parents), perms, all).map((d) => d.id)

  it('filters by parent', () => {
    expect(ids(['media'], [])).toEqual(['c'])
    expect(ids([], [])).toEqual([])
  })
  it('filters by permission', () => {
    expect(ids(['settings'], [])).toEqual(['a'])
    expect(ids(['settings'], ['p.x'])).toEqual(['a', 'b'])
  })
  it('uses the real registry by default', () => {
    const got = availableSubDestinations(new Set(['connections']), ['site.details.read'])
    expect(got.map((d) => d.id)).toContain('connected-affiliate-programs')
    expect(availableSubDestinations(new Set(['connections']), []).map((d) => d.id)).not.toContain('connected-affiliate-programs')
  })
})

describe('destination strings', () => {
  it('every id has a label and keywords in en, it and de', () => {
    for (const locale of ['en', 'it', 'de']) {
      const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), `messages/${locale}.json`), 'utf8'))
      const block = messages.app?.search?.destinations ?? {}
      for (const d of SUB_DESTINATIONS) {
        expect(block[d.id]?.label, `${locale}.${d.id}.label`).toBeTruthy()
        expect(block[d.id]?.keywords, `${locale}.${d.id}.keywords`).toBeTruthy()
      }
    }
  })
})
