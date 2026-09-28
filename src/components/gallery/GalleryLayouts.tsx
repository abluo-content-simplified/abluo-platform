'use client'

import { useRef, type CSSProperties } from 'react'
import { SlideUp } from '@/components/animation/SlideUp'
import type { GalleryViewItem } from '@/lib/gallery/view'
import { planTiles, aspectCss, type GalleryLayout, type TileShape } from '@/lib/gallery/layout'
import { GalleryTile } from './GalleryTile'

// ── Layout renderers (ADR-022 §4) ─────────────────────────────────────────────
// Grid family (grid, featured, wideLead): fixed tile shapes planned per
// breakpoint on a 12-track grid by planTiles() — see src/lib/gallery/layout.ts
// for why this can never leave gaps or orphans.
// No-crop family (rows, masonry): each photo keeps its own proportions.
// Carousel: one horizontal, swipeable strip.

export interface LayoutProps {
  items: GalleryViewItem[]
  layout: GalleryLayout
  columns: number
  shape: TileShape
  spacing: 'tight' | 'normal' | 'loose'
  showCaptions: boolean
  /** Returns the open handler for an item, or undefined when the lightbox is off. */
  openHandler: (item: GalleryViewItem) => (() => void) | undefined
  openLabel: (index: number) => string
  videoLabel: string
  scrollBackLabel: string
  scrollForwardLabel: string
  duration: number
  ease: unknown
}

const GAP: Record<LayoutProps['spacing'], { gap: string; mb: string; px: number }> = {
  tight: { gap: 'gap-1', mb: 'mb-1', px: 4 },
  normal: { gap: 'gap-3', mb: 'mb-3', px: 12 },
  loose: { gap: 'gap-6', mb: 'mb-6', px: 24 },
}

// Static class strings (Tailwind must see them verbatim); the numbers arrive as
// CSS custom properties set per tile.
const GRID_ITEM =
  'flex min-h-0 flex-col ' +
  '[grid-column:span_var(--g-b)/span_var(--g-b)] sm:[grid-column:span_var(--g-s)/span_var(--g-s)] md:[grid-column:span_var(--g-m)/span_var(--g-m)] ' +
  'md:[grid-row:span_var(--r-m)/span_var(--r-m)]'
const GRID_BOX = 'grow [aspect-ratio:var(--a-b)] sm:[aspect-ratio:var(--a-s)] md:[aspect-ratio:var(--a-m)]'

function GridLayout(p: LayoutProps) {
  const plan = planTiles(p.layout, p.items.length, p.columns, p.shape)
  return (
    <div className={`grid grid-cols-12 ${GAP[p.spacing].gap}`}>
      {p.items.map((item, i) => {
        const t = plan[i]
        const vars = {
          '--g-b': t.base.span,
          '--g-s': t.sm.span,
          '--g-m': t.md.span,
          '--r-m': t.md.rowSpan,
          '--a-b': aspectCss(t.base.aspect),
          '--a-s': aspectCss(t.sm.aspect),
          '--a-m': aspectCss(t.md.aspect),
        } as CSSProperties
        const sizes = `(max-width: 640px) ${Math.round((t.base.span / 12) * 100)}vw, (max-width: 768px) ${Math.round((t.sm.span / 12) * 100)}vw, ${Math.round((t.md.span / 12) * 100)}vw`
        return (
          <SlideUp key={item.key} duration={p.duration} ease={p.ease} delay={Math.min(i * 0.04, 0.4)} className={GRID_ITEM} style={vars}>
            <GalleryTile
              item={item}
              onOpen={p.openHandler(item)}
              openLabel={p.openLabel(i)}
              boxClassName={GRID_BOX}
              sizes={sizes}
              showCaption={p.showCaptions}
              videoLabel={p.videoLabel}
            />
          </SlideUp>
        )
      })}
    </div>
  )
}

// Justified rows: every photo keeps its proportions and each row fills the
// width exactly. Pure CSS — flex-grow proportional to the aspect ratio makes
// every tile in a row the same height. The trailing spacer takes the free space
// of the LAST row only, so that row keeps its natural height instead of being
// blown up to fill the width.
function RowsLayout(p: LayoutProps) {
  return (
    <div className={`flex flex-wrap ${GAP[p.spacing].gap} [--row-h:150px] sm:[--row-h:200px] md:[--row-h:260px]`}>
      {p.items.map((item, i) => (
        <SlideUp
          key={item.key}
          duration={p.duration}
          ease={p.ease}
          delay={Math.min(i * 0.04, 0.4)}
          style={{ flexGrow: item.aspect, flexBasis: `calc(var(--row-h) * ${item.aspect})` }}
        >
          <GalleryTile
            item={item}
            onOpen={p.openHandler(item)}
            openLabel={p.openLabel(i)}
            boxStyle={{ aspectRatio: String(item.aspect) }}
            sizes="(max-width: 640px) 100vw, 50vw"
            showCaption={p.showCaptions}
            videoLabel={p.videoLabel}
          />
        </SlideUp>
      ))}
      <div aria-hidden="true" className="h-0 grow-[99999] basis-0" />
    </div>
  )
}

const MASONRY_COLUMNS: Record<number, string> = {
  2: 'columns-1 sm:columns-2',
  3: 'columns-1 sm:columns-2 md:columns-3',
  4: 'columns-2 md:columns-4',
}

// Masonry: columns with no cropping and a ragged bottom. Order runs down each
// column — inherent to CSS columns, and fine for a loose set of photos.
function MasonryLayout(p: LayoutProps) {
  return (
    <div className={`${MASONRY_COLUMNS[p.columns] ?? MASONRY_COLUMNS[3]} ${GAP[p.spacing].gap}`}>
      {p.items.map((item, i) => (
        <SlideUp key={item.key} duration={p.duration} ease={p.ease} delay={Math.min(i * 0.04, 0.4)} className={`${GAP[p.spacing].mb} break-inside-avoid`}>
          <GalleryTile
            item={item}
            onOpen={p.openHandler(item)}
            openLabel={p.openLabel(i)}
            boxStyle={{ aspectRatio: String(item.aspect) }}
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
            showCaption={p.showCaptions}
            videoLabel={p.videoLabel}
          />
        </SlideUp>
      ))}
    </div>
  )
}

// Carousel: one horizontal strip, swipeable on touch (native scrolling with
// snap points), with previous/next buttons on wider screens.
function CarouselLayout(p: LayoutProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' })
  }
  const buttonClass =
    'absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow md:flex focus-visible:outline-2 focus-visible:outline-offset-2'
  const buttonStyle: CSSProperties = {
    backgroundColor: 'color-mix(in oklch, var(--color-background) 88%, transparent)',
    color: 'var(--color-text-primary)',
    outlineColor: 'var(--color-primary)',
  }
  return (
    <SlideUp duration={p.duration} ease={p.ease} className="relative">
      <div
        ref={scroller}
        className={`flex snap-x snap-mandatory overflow-x-auto pb-2 [scrollbar-width:thin] ${GAP[p.spacing].gap}`}
      >
        {p.items.map((item, i) => (
          <div key={item.key} className="h-56 shrink-0 snap-start md:h-80" style={{ aspectRatio: String(item.aspect) }}>
            <GalleryTile
              item={item}
              onOpen={p.openHandler(item)}
              openLabel={p.openLabel(i)}
              boxClassName="h-full"
              sizes="(max-width: 768px) 80vw, 40vw"
              showCaption={false}
              videoLabel={p.videoLabel}
            />
          </div>
        ))}
      </div>
      {p.items.length > 1 && (
        <>
          <button type="button" onClick={() => scrollBy(-1)} aria-label={p.scrollBackLabel} className={`${buttonClass} left-2`} style={buttonStyle}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label={p.scrollForwardLabel} className={`${buttonClass} right-2`} style={buttonStyle}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </>
      )}
    </SlideUp>
  )
}

export function GalleryLayoutView(p: LayoutProps) {
  switch (p.layout) {
    case 'rows':
      return <RowsLayout {...p} />
    case 'masonry':
      return <MasonryLayout {...p} />
    case 'carousel':
      return <CarouselLayout {...p} />
    default:
      return <GridLayout {...p} />
  }
}
