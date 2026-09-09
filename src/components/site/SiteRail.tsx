'use client'

import { useEffect, useState } from 'react'

/**
 * SiteRail — a single accent rule running the full height of the document.
 *
 * The original tmz.it draws this as `.hero::before`: a 2px orange bar inset
 * 3.5rem from the left edge, growing from height 0 to 100% of the HERO on load.
 * This is the same idea extended to the whole page — it measures the document
 * rather than one section, so it reads as the spine the content hangs off
 * instead of a decoration on the first screen.
 *
 * ── Why it is fixed, not absolute ────────────────────────────────────────────
 * An absolutely positioned bar `height: 100%` of a 9000px document is a 9000px
 * paint on every scroll frame, and it needs the document height at mount, which
 * changes as images load and sections reveal. A `position: fixed` bar spanning
 * the viewport is one screenful of paint, is always exactly full height, and is
 * indistinguishable from the tall version while scrolling — the bar has no
 * features to track against.
 *
 * ── The intro ────────────────────────────────────────────────────────────────
 * It draws downward once, on load, matching the source: 1s on
 * cubic-bezier(.16,1,.3,1) after a 0.3s beat, so it arrives just before the
 * eyebrow. It never replays. Under `prefers-reduced-motion` it is simply there.
 *
 * ── Clearance ────────────────────────────────────────────────────────────────
 * The rail does NOT reserve its own space — it is decoration, and giving it
 * layout would shift every section. Content clearance is the page's job:
 * `--rail-inset` and `--rail-clearance` are published here so the layout can
 * pad against them, which is what stops text touching the bar the way it does
 * on the original.
 */

/** Distance from the viewport's left edge. Matches the source's `left: 3.5rem`. */
export const RAIL_INSET = '3.5rem'
/** Bar thickness. Double the source's 2px, at Tom's request. */
export const RAIL_WIDTH = '4px'
/** Gap between the bar and any content beside it. */
export const RAIL_CLEARANCE = '1.5rem'

export function SiteRail() {
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    // Two frames, not a timeout: the first commits the collapsed state to the
    // DOM, the second lets the transition observe a change. A single frame can
    // batch both and the bar snaps to full height with no animation at all.
    const a = requestAnimationFrame(() => {
      const b = requestAnimationFrame(() => setDrawn(true))
      return () => cancelAnimationFrame(b)
    })
    return () => cancelAnimationFrame(a)
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-[var(--rail-inset)] top-0 z-[5] motion-reduce:!h-screen motion-reduce:!transition-none"
      style={{
        width: 'var(--rail-width)',
        backgroundColor: 'var(--color-primary)',
        height: drawn ? '100vh' : 0,
        transition: 'height 1s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
      }}
    />
  )
}
