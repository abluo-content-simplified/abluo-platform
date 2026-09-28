import { describe, it, expect } from 'vitest'
import { planTiles } from '@/lib/gallery/layout'

// The featured-layout decision as the section applies it (ADR-022 §4).
// Rebuilt as a uniform grid, Claudia Hoffmann's studio gallery became four
// identical tiles and lost the composition the old site had: one establishing
// shot leading, the rest supporting. The first fix then left gaps beside the
// lead; planTiles() is where both are now prevented. Full coverage lives in
// src/lib/gallery/__tests__/layout.test.ts.

const isFeaturedLead = (layout: 'grid' | 'featured', count: number) => {
  const plan = planTiles(layout, count, 3, 'square')
  return count > 0 && plan[0].md.rowSpan >= 2
}

describe('gallery featured layout', () => {
  it('defaults to grid, so every existing gallery is unchanged', () => {
    expect(isFeaturedLead('grid', 8)).toBe(false)
  })

  it('features the first image when asked and there is enough to feature against', () => {
    expect(isFeaturedLead('featured', 4)).toBe(true)
    expect(isFeaturedLead('featured', 3)).toBe(true)
  })

  it('falls back to a grid below three items', () => {
    expect(isFeaturedLead('featured', 2)).toBe(false)
    expect(isFeaturedLead('featured', 1)).toBe(false)
    expect(isFeaturedLead('featured', 0)).toBe(false)
  })
})
