// ── Gallery tile plans ────────────────────────────────────────────────────────
// ADR-022 §4. The layout decides the shape of every tile; the photo is cropped
// into it around its focal point. Editors control only ORDER and LAYOUT, never
// the size of an individual photo.
//
// Two defects on the live Hoffmann gallery are what this file exists to make
// impossible:
//
//   1. Gaps. The featured lead tile was forced square while the tiles beside it
//      kept the section's 4:3 ratio. The square set the row height, the shorter
//      landscape tiles did not fill it, and the page showed bands of empty
//      background. The lead now has NO ratio of its own on wide screens: it
//      stretches to exactly the height of the two tiles stacked beside it.
//   2. Orphans. Four photos in three columns left the fourth alone on a row,
//      a third of the width. An uneven last row now spreads across the full
//      width, each of its tiles widened and given a proportionally wider shape
//      so the row keeps the same height as the rows above it.
//
// Everything is planned on a 12-track grid (12 is divisible by every column
// count and every possible remainder: 1, 2, 3, 4), per breakpoint, because the
// column count changes with the viewport and so does the remainder. The plan is
// pure data; the component turns it into CSS custom properties.

export type GalleryLayout = 'grid' | 'featured' | 'wideLead' | 'rows' | 'masonry' | 'carousel'
export type TileShape = 'square' | 'landscape' | 'portrait'
export type Breakpoint = 'base' | 'sm' | 'md'
export const BREAKPOINTS: Breakpoint[] = ['base', 'sm', 'md']

export const GRID_TRACKS = 12

/** width / height */
export const SHAPE_ASPECT: Record<TileShape, number> = {
  square: 1,
  landscape: 4 / 3,
  portrait: 3 / 4,
}

const LAYOUTS: GalleryLayout[] = ['grid', 'featured', 'wideLead', 'rows', 'masonry', 'carousel']

export function normalizeLayout(value: string | null | undefined): GalleryLayout {
  return LAYOUTS.includes(value as GalleryLayout) ? (value as GalleryLayout) : 'grid'
}

/**
 * The stored `imageRatio`. 'auto' is retired (ADR-022 §4 — a tile keeping the
 * photo's own shape is exactly what produced the gaps); a stored 'auto' reads
 * as landscape. The no-crop layouts are `rows` and `masonry`.
 */
export function normalizeShape(value: string | null | undefined): TileShape {
  if (value === 'landscape' || value === 'auto') return 'landscape'
  if (value === 'portrait') return 'portrait'
  return 'square'
}

/** Columns per breakpoint for the authored column count (matches the historical grid). */
export function columnsAt(columns: number | null | undefined): Record<Breakpoint, number> {
  switch (columns) {
    case 2:
      return { base: 1, sm: 2, md: 2 }
    case 4:
      return { base: 2, sm: 2, md: 4 }
    case 3:
    default:
      return { base: 1, sm: 2, md: 3 }
  }
}

export interface CellPlan {
  /** Tracks spanned, out of GRID_TRACKS. */
  span: number
  /** Rows spanned (1 unless the featured lead). */
  rowSpan: number
  /** width/height, or null = stretch to the row height (featured lead only). */
  aspect: number | null
}

export type TilePlan = Record<Breakpoint, CellPlan>

/**
 * Equal tiles in `cols` columns, with no orphans.
 *
 * An uneven last row is spread across the full width, each tile widened and
 * given a proportionally wider shape so the row keeps the height of the rows
 * above it. Widening one photo to three times its width is a brutal crop,
 * though (a portrait photo becomes a strip of rug), so when the remainder is
 * small the last TWO rows are rebalanced first: 3 + 1 becomes 2 + 2, 4 + 1
 * becomes 3 + 2, 4 + 2 becomes 3 + 3. No tile is then ever widened by more than
 * half again, except a single leftover in a two-column grid (2x).
 */
export function gridCells(count: number, cols: number, aspect: number): CellPlan[] {
  if (count <= 0) return []
  const c = Math.max(1, cols)
  const remainder = count % c
  const fullRows = Math.floor(count / c)
  const equal = (n: number): CellPlan[] =>
    Array.from({ length: n }, () => ({ span: GRID_TRACKS / c, rowSpan: 1, aspect }))
  const widened = (n: number): CellPlan[] =>
    Array.from({ length: n }, () => ({ span: GRID_TRACKS / n, rowSpan: 1, aspect: (aspect * c) / n }))

  if (remainder === 0) return equal(count)

  const rebalance = c >= 3 && fullRows >= 1 && remainder * 2 <= c
  if (!rebalance) return [...equal(fullRows * c), ...widened(remainder)]

  const tail = c + remainder
  const first = Math.ceil(tail / 2)
  const second = tail - first
  return [...equal((fullRows - 1) * c), ...widened(first), ...widened(second)]
}

/** Wide lead shape on wide screens (16:9 — wider crops lose too much of a photo). */
export const WIDE_LEAD_ASPECT = 16 / 9

function cellsAt(layout: GalleryLayout, count: number, cols: number, aspect: number, bp: Breakpoint): CellPlan[] {
  if (layout === 'featured' && count >= 3) {
    if (cols >= 3) {
      // Lead: two thirds wide, NO ratio — it stretches to the height of the
      // tiles stacked beside it, so it can never leave a gap. Two tiles stack
      // beside it; with exactly four photos the fourth joins them (three
      // stacked) rather than sitting alone on a row of its own.
      const beside = count === 4 ? 3 : 2
      return [
        { span: 8, rowSpan: beside, aspect: null },
        ...Array.from({ length: beside }, () => ({ span: 4, rowSpan: 1, aspect })),
        ...gridCells(count - 1 - beside, 3, aspect),
      ]
    }
    // Narrow screens: the lead takes the full row, the rest follow as a grid.
    return [{ span: GRID_TRACKS, rowSpan: 1, aspect }, ...gridCells(count - 1, cols, aspect)]
  }
  if (layout === 'wideLead' && count >= 2) {
    const leadAspect = bp === 'base' ? aspect : Math.max(aspect, WIDE_LEAD_ASPECT)
    return [{ span: GRID_TRACKS, rowSpan: 1, aspect: leadAspect }, ...gridCells(count - 1, cols, aspect)]
  }
  return gridCells(count, cols, aspect)
}

/**
 * The per-breakpoint plan for every tile of a grid-family layout
 * (grid, featured, wideLead). Featured uses three columns on wide screens
 * whatever the authored column count — the composition is defined in thirds.
 */
export function planTiles(
  layout: GalleryLayout,
  count: number,
  columns: number | null | undefined,
  shape: TileShape
): TilePlan[] {
  const aspect = SHAPE_ASPECT[shape]
  const cols = columnsAt(layout === 'featured' ? 3 : columns)
  const perBp = {} as Record<Breakpoint, CellPlan[]>
  for (const bp of BREAKPOINTS) perBp[bp] = cellsAt(layout, count, cols[bp], aspect, bp)
  return Array.from({ length: count }, (_, i) => ({
    base: perBp.base[i],
    sm: perBp.sm[i],
    md: perBp.md[i],
  }))
}

/** Is this layout one of the fixed-shape grid family? */
export function isGridFamily(layout: GalleryLayout): boolean {
  return layout === 'grid' || layout === 'featured' || layout === 'wideLead'
}

/** A photo's natural width/height, with a sane fallback when metadata is missing. */
export function naturalAspect(dimensions: { width?: number; height?: number; aspectRatio?: number } | null | undefined): number {
  if (dimensions?.aspectRatio && dimensions.aspectRatio > 0) return dimensions.aspectRatio
  if (dimensions?.width && dimensions?.height) return dimensions.width / dimensions.height
  return 3 / 2
}

/** CSS value for an aspect ratio, or 'auto' for a stretch cell. */
export function aspectCss(aspect: number | null): string {
  if (aspect === null) return 'auto'
  return String(Math.round(aspect * 10000) / 10000)
}
