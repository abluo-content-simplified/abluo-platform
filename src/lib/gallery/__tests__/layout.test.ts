import { describe, it, expect } from 'vitest'
import { gridCells, planTiles, normalizeShape, normalizeLayout, isGridFamily, mosaicBlocks, GRID_TRACKS, SHAPE_ASPECT, type CellPlan } from '../layout'

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

describe('mosaic', () => {
  /** Every wide-screen tile placed, no overlap, and every row covered edge to edge. */
  function assertSolid(cells: CellPlan[]) {
    const taken = new Map<string, number>()
    let lastRow = 0
    cells.forEach((c, i) => {
      expect(c.col, `tile ${i} has a column`).toBeGreaterThanOrEqual(1)
      expect(c.row, `tile ${i} has a row`).toBeGreaterThanOrEqual(1)
      expect(c.col! - 1 + c.span).toBeLessThanOrEqual(GRID_TRACKS)
      for (let r = c.row!; r < c.row! + c.rowSpan; r++) {
        for (let t = c.col!; t < c.col! + c.span; t++) {
          const key = `${r}:${t}`
          expect(taken.has(key), `tile ${i} overlaps tile ${taken.get(key)} at ${key}`).toBe(false)
          taken.set(key, i)
        }
        lastRow = Math.max(lastRow, r)
      }
    })
    for (let r = 1; r <= lastRow; r++) {
      for (let t = 1; t <= GRID_TRACKS; t++) expect(taken.has(`${r}:${t}`), `hole at row ${r}, track ${t}`).toBe(true)
    }
  }

  it('is a known layout of the fixed-shape family', () => {
    expect(normalizeLayout('mosaic')).toBe('mosaic')
    expect(isGridFamily('mosaic')).toBe(true)
  })

  it('repeats big left · row of three · big right · row of three', () => {
    expect(mosaicBlocks(12).map((b) => b.block)).toEqual(['bigLeft', 'row', 'bigRight', 'row'])
    const md = planTiles('mosaic', 6, 3, 'landscape').map((t) => t.md)
    expect(md[0]).toMatchObject({ span: 8, rowSpan: 2, aspect: null, col: 1, row: 1 })
    expect(md[1]).toMatchObject({ span: 4, col: 9, row: 1 })
    expect(md[2]).toMatchObject({ span: 4, col: 9, row: 2 })
    expect(md.slice(3).map((c) => [c.col, c.row])).toEqual([[1, 3], [5, 3], [9, 3]])
    const big = planTiles('mosaic', 9, 3, 'landscape')[6].md
    expect(big).toMatchObject({ span: 8, rowSpan: 2, col: 5, row: 4 })
  })

  it('never leaves a hole or a lone tile, whatever the count', () => {
    for (let count = 3; count <= 30; count++) {
      const md = planTiles('mosaic', count, 3, 'landscape').map((t) => t.md)
      expect(md).toHaveLength(count)
      assertSolid(md)
      // No tile is ever stranded alone on a row.
      const perRow = new Map<number, number>()
      for (const c of md) if (c.rowSpan === 1 && c.span !== 4) perRow.set(c.row!, (perRow.get(c.row!) ?? 0) + 1)
      for (const n of perRow.values()) expect(n).toBeGreaterThanOrEqual(2)
    }
  })

  it('handles the end like the grid: 2 leftovers share a row, 1 rebalances', () => {
    expect(mosaicBlocks(11).map((b) => `${b.block}:${b.size}`)).toEqual(['bigLeft:3', 'row:3', 'bigRight:3', 'pair:2'])
    expect(mosaicBlocks(7).map((b) => `${b.block}:${b.size}`)).toEqual(['bigLeft:3', 'pair:2', 'pair:2'])
    expect(mosaicBlocks(4).map((b) => `${b.block}:${b.size}`)).toEqual(['bigLeft:4'])
    // A pair keeps the height of a row of three.
    const pair = planTiles('mosaic', 11, 3, 'landscape')[9].md
    expect(pair.aspect).toBeCloseTo((4 / 3) * 1.5)
  })

  it('tablets: one wide photo, then pairs; phones: one column; ignores the authored column count', () => {
    const plan = planTiles('mosaic', 7, 4, 'landscape')
    expect(plan.map((t) => t.sm.span)).toEqual([12, 6, 6, 6, 6, 12, 12])
    expect(plan.every((t) => t.base.span === 12)).toBe(true)
    expect(plan[0].md.col).toBe(1)
  })

  it('fewer than three photos fall back to the grid', () => {
    expect(planTiles('mosaic', 2, 3, 'square').map((t) => t.md.span)).toEqual([6, 6])
  })
})
