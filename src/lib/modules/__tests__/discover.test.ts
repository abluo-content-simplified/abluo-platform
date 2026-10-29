import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { buildDiscover, DISCOVER_ICONS, DISCOVER_MODULE_IDS, discoverRequestHref } from '../discover'

describe('discover', () => {
  it('only offers real, placed modules, each with an icon', () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id))
    for (const id of DISCOVER_MODULE_IDS) {
      expect(ids.has(id)).toBe(true)
      expect(DISCOVER_ICONS[id]).toBeTruthy()
    }
  })

  it('leaves out installed modules and groups the rest like the sidebar', () => {
    const groups = buildDiscover(['blog', 'forms', 'gallery'])
    const all = groups.flatMap((g) => g.moduleIds)
    expect(all).not.toContain('blog')
    expect(all).not.toContain('forms')
    expect(all).not.toContain('gallery')
    expect(groups.map((g) => g.id)).toEqual(['publish', 'show', 'visitors', 'tools'])
    expect(groups[0].moduleIds).toEqual(['news', 'events', 'faq', 'live'])
  })

  it('is empty when everything is installed', () => {
    expect(buildDiscover(DISCOVER_MODULE_IDS)).toEqual([])
  })

  it('builds a prefilled, encoded support link', () => {
    const href = discoverRequestHref('acme', 'More about Events & more', 'Hi there')
    const url = new URL(href, 'https://x.test')
    expect(url.pathname).toBe('/acme/support/new')
    expect(url.searchParams.get('title')).toBe('More about Events & more')
    expect(url.searchParams.get('from')).toBe('/acme/discover')
  })
})
