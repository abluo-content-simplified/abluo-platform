import { describe, it, expect } from 'vitest'
import { gridCells, planTiles, normalizeShape, normalizeLayout, GRID_TRACKS, SHAPE_ASPECT } from '../layout'

const sumSpans = (spans: number[]) => spans.reduce((a, b) => a + b, 0)

describe('gridCells — no orphans', () => {
  it('fills complete rows with equal tiles', () => {
    const cells = gridCells(6, 3, 1)
    expect(cells.every((c) => c.span === 4 && c.aspect === 1)).toBe(true)
  })

  it('rebalances 3 + 1 into 2 + 2 rather than stretching one photo across the row', () => {
    // Hoffmann: 4 photos in 3 columns used to strand the fourth; a full-width
    // fourth tile then turned a portrait photo into a strip of rug.
    const cells = gridCells(4, 3, 4 / 3)
    expect(cells.map((c) => c.span)).toEqual([6, 6, 6, 6])
    // Half again as wide, half again the ratio → same height as a normal row.
    expect(cells[0].aspect).toBeCloseTo(2)
  })

  it('spreads two leftover tiles across the full width', () => {
    const cells = gridCells(5, 3, 1)
    expect(cells.slice(3).map((c) => c.span)).toEqual([6, 6])
    expect(cells[3].aspect).toBeCloseTo(1.5)
  })

  it('rebalances in four columns too, and never widens a tile by more than half again', () => {
    expect(gridCells(5, 4, 1).map((c) => c.span)).toEqual([4, 4, 4, 6, 6])
    expect(gridCells(6, 4, 1).map((c) => c.span)).toEqual([4, 4, 4, 4, 4, 4])
    for (const cols of [3, 4]) {
      for (let count = cols + 1; count <= 13; count++) {
        for (const cell of gridCells(count, cols, 1)) expect(cell.aspect!).toBeLessThanOrEqual(2 + 1e-9)
      }
    }
  })

  it('keeps a lone leftover in two columns at double width (nothing to rebalance with)', () => {
    const cells = gridCells(3, 2, 1)
    expect(cells[2]).toEqual({ span: 12, rowSpan: 1, aspect: 2 })
  })

  it('every row sums to the full track count for any count and column count', () => {
    for (const cols of [1, 2, 3, 4]) {
      for (let count = 1; count <= 13; count++) {
        const cells = gridCells(count, cols, 1)
        expect(sumSpans(cells.map((c) => c.span)) % GRID_TRACKS).toBe(0)
      }
    }
  })
})

describe('planTiles — featured', () => {
  it('gives the lead no ratio on wide screens, so it stretches to the two tiles beside it', () => {
    const plan = planTiles('featured', 5, 3, 'landscape')
    expect(plan[0].md).toEqual({ span: 8, rowSpan: 2, aspect: null })
    expect(plan[1].md.aspect).toBeCloseTo(SHAPE_ASPECT.landscape)
    expect(plan[2].md.aspect).toBeCloseTo(SHAPE_ASPECT.landscape)
  })

  it('stacks the fourth photo beside the lead instead of orphaning it', () => {
    const plan = planTiles('featured', 4, 3, 'landscape')
    expect(plan[0].md.rowSpan).toBe(3)
    expect(plan.slice(1).map((p) => p.md.span)).toEqual([4, 4, 4])
  })

  it('flows photos after the featured block as a gap-free grid', () => {
    const plan = planTiles('featured', 7, 3, 'square')
    expect(plan[0].md.rowSpan).toBe(2)
    // 4 left after the block → rebalanced 2 + 2.
    expect(plan.slice(3).map((p) => p.md.span)).toEqual([6, 6, 6, 6])
  })

  it('puts the lead on its own full row on phones', () => {
    const plan = planTiles('featured', 4, 3, 'square')
    expect(plan[0].base.span).toBe(GRID_TRACKS)
    expect(plan[0].base.aspect).toBe(1)
  })

  it('falls back to a plain grid below three items', () => {
    const plan = planTiles('featured', 2, 3, 'square')
    expect(plan[0].md.rowSpan).toBe(1)
    expect(plan[0].md.aspect).not.toBeNull()
  })
})

describe('planTiles — wide lead', () => {
  it('spans the first photo across the full width', () => {
    const plan = planTiles('wideLead', 4, 3, 'square')
    expect(plan[0].md.span).toBe(GRID_TRACKS)
    expect(plan[0].md.aspect).toBeCloseTo(16 / 9)
    // The remaining three fill one full row.
    expect(plan.slice(1).map((p) => p.md.span)).toEqual([4, 4, 4])
  })
})

describe('normalizers', () => {
  it('reads a retired "auto" ratio as landscape', () => {
    expect(normalizeShape('auto')).toBe('landscape')
    expect(normalizeShape(undefined)).toBe('square')
  })
  it('falls back to grid for unknown layouts', () => {
    expect(normalizeLayout('nonsense')).toBe('grid')
    expect(normalizeLayout('rows')).toBe('rows')
  })
})
