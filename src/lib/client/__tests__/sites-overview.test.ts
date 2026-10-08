import { describe, expect, it } from 'vitest'
import { overviewNeeded, sortSiteCards } from '../sites-overview'

describe('sites overview', () => {
  it('only people with more than one site get the overview', () => {
    expect(overviewNeeded(0)).toBe(false)
    expect(overviewNeeded(1)).toBe(false)
    expect(overviewNeeded(2)).toBe(true)
  })
  it('sites with open contact requests come first, then by name', () => {
    const out = sortSiteCards([
      { name: 'Livener', openRequests: 0 },
      { name: 'amélie', openRequests: null },
      { name: 'Hoffmann', openRequests: 2 },
      { name: 'Abluo', openRequests: 0 },
    ])
    expect(out.map((c) => c.name)).toEqual(['Hoffmann', 'Abluo', 'amélie', 'Livener'])
  })
})
