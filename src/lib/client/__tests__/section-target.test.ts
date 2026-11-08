import { describe, expect, it } from 'vitest'
import { sectionIdFromHref, shouldReveal } from '../section-target'

describe('sectionIdFromHref', () => {
  it('reads the hash', () => {
    expect(sectionIdFromHref('/x/settings#form-notifications')).toBe('form-notifications')
    expect(sectionIdFromHref('#invoices')).toBe('invoices')
    expect(sectionIdFromHref('/x/taxonomy?tab=media#tags')).toBe('tags')
  })
  it('is null without a usable hash', () => {
    expect(sectionIdFromHref('/x/settings')).toBeNull()
    expect(sectionIdFromHref('/x/settings#')).toBeNull()
    expect(sectionIdFromHref('')).toBeNull()
  })
  it('decodes, and survives a bad escape', () => {
    expect(sectionIdFromHref('#a%20b')).toBe('a b')
    expect(sectionIdFromHref('#%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('shouldReveal', () => {
  it('collapses the same id inside the window only', () => {
    expect(shouldReveal(null, 'a', 1000)).toBe(true)
    expect(shouldReveal({ id: 'a', at: 1000 }, 'a', 1300)).toBe(false)
    expect(shouldReveal({ id: 'a', at: 1000 }, 'a', 1700)).toBe(true)
    expect(shouldReveal({ id: 'a', at: 1000 }, 'b', 1100)).toBe(true)
  })
})
