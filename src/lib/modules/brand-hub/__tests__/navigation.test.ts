import { describe, it, expect } from 'vitest'
import { BRAND_HUB_PAGE_ORDER, adjacentPages, introDismissKey } from '../navigation'
import { BRAND_HUB_NAV_GROUPS, BRAND_HUB_PAGES } from '../types'

describe('Brand Hub pager', () => {
  it('follows the side navigation and covers every page once', () => {
    expect(BRAND_HUB_PAGE_ORDER).toEqual(BRAND_HUB_NAV_GROUPS.flatMap((g) => g.pages))
    expect([...BRAND_HUB_PAGE_ORDER].sort()).toEqual([...BRAND_HUB_PAGES].sort())
  })
  it('first page has only next, last only previous', () => {
    const first = BRAND_HUB_PAGE_ORDER[0]
    const last = BRAND_HUB_PAGE_ORDER[BRAND_HUB_PAGE_ORDER.length - 1]
    expect(adjacentPages(first)).toEqual({ previous: null, next: BRAND_HUB_PAGE_ORDER[1] })
    expect(adjacentPages(last).next).toBeNull()
    expect(adjacentPages(last).previous).toBe(BRAND_HUB_PAGE_ORDER[BRAND_HUB_PAGE_ORDER.length - 2])
  })
  it('a middle page links both ways', () => {
    const p = BRAND_HUB_PAGE_ORDER[3]
    expect(adjacentPages(p)).toEqual({ previous: BRAND_HUB_PAGE_ORDER[2], next: BRAND_HUB_PAGE_ORDER[4] })
  })
})

describe('welcome dismissal key', () => {
  it('is one per site, not per language', () => {
    expect(introDismissKey('/en/acme/brand')).toBe(introDismissKey('/it/acme/brand'))
    expect(introDismissKey('/en/acme/brand')).not.toBe(introDismissKey('/en/other/brand'))
    expect(introDismissKey('/en/brand')).toBe(introDismissKey('/de/brand'))
  })
})
