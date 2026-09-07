import { describe, it, expect } from 'vitest'

// The featured-layout decision, extracted as the component applies it.
// Rebuilt as a uniform grid, Claudia Hoffmann's studio gallery became four
// identical tiles and lost the composition the old site had: one establishing
// shot leading, the rest supporting.
function isFeatured(layout: string | undefined, itemCount: number): boolean {
  return (layout ?? 'grid') === 'featured' && itemCount >= 3
}

describe('gallery featured layout', () => {
  it('defaults to grid, so every existing gallery is unchanged', () => {
    expect(isFeatured(undefined, 8)).toBe(false)
    expect(isFeatured('grid', 8)).toBe(false)
  })

  it('features the first image when asked and there is enough to feature against', () => {
    expect(isFeatured('featured', 4)).toBe(true)
    expect(isFeatured('featured', 3)).toBe(true)
  })

  it('falls back to a grid below three items', () => {
    // One large image beside a single small one is not a composition.
    expect(isFeatured('featured', 2)).toBe(false)
    expect(isFeatured('featured', 1)).toBe(false)
    expect(isFeatured('featured', 0)).toBe(false)
  })
})
