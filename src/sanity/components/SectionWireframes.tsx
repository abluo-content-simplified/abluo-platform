/**
 * Section wireframes — tiny schematic previews for the Studio.
 *
 * Sanity shows a section's `icon` in the "Add item" menu and its `preview.media`
 * on each row of the sections list. Both accept any React component, so instead
 * of a generic glyph that says "section" thirty times, each type gets a small
 * diagram of its own LAYOUT: where the rules fall, how the columns split, what
 * is aligned to which edge.
 *
 * That is the thing an editor actually needs to tell two sections apart. A name
 * ("Venture List", "Clients Flow") tells you what the content is; the wireframe
 * tells you what it will look like on the page, which is the question being
 * asked at the moment someone opens the Add menu.
 *
 * Rules for drawing them:
 *   - `currentColor` only. The Studio has a light and a dark theme and these
 *     must read in both; a hardcoded grey is invisible in one of them.
 *   - Opacity carries hierarchy: 1 for structure (rules, the accent mark),
 *     ~0.55 for headings, ~0.25 for body copy. Never more than three levels.
 *   - 24×24, no stroke smaller than 1. These render at 16–20px in the Add menu,
 *     and anything finer than a whole pixel turns to mud.
 *   - Schematic, not literal. Four bars mean "a paragraph", not four lines.
 */

const BOX = { width: '1.2em', height: '1.2em', viewBox: '0 0 24 24' } as const

/** Venture list — full-width rows, rule-separated, a marker on the right edge. */
export function VentureListWireframe() {
  return (
    <svg {...BOX} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {[3, 11, 19].map((y) => (
        <g key={y}>
          <rect x="2" y={y - 1} width="9" height="2" fill="currentColor" opacity="0.55" />
          <rect x="2" y={y + 2.5} width="6" height="1" fill="currentColor" opacity="0.25" />
          <rect x="17" y={y - 1} width="5" height="2" fill="currentColor" />
          {y !== 19 && <line x1="2" y1={y + 6} x2="22" y2={y + 6} stroke="currentColor" strokeWidth="1" opacity="0.3" />}
        </g>
      ))}
    </svg>
  )
}

/** Clients flow — words of varying length wrapping like prose across three lines. */
export function ClientsFlowWireframe() {
  const rows: Array<[number, number[]]> = [
    [5, [5, 4, 6]],
    [11, [4, 7, 4]],
    [17, [6, 5]],
  ]
  return (
    <svg {...BOX} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {rows.map(([y, widths]) => {
        let x = 2
        return (
          <g key={y}>
            {widths.map((w, i) => {
              const el = (
                <g key={i}>
                  <rect x={x} y={y - 1.5} width={w} height="3" fill="currentColor" opacity="0.55" />
                  {i < widths.length - 1 && (
                    <line
                      x1={x + w + 0.8}
                      y1={y + 1.5}
                      x2={x + w + 1.8}
                      y2={y - 1.5}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  )}
                </g>
              )
              x += w + 2.6
              return el
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** Career timeline — a fixed date column on the left, the role on the right. */
export function CareerTimelineWireframe() {
  return (
    <svg {...BOX} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {[4, 12, 20].map((y) => (
        <g key={y}>
          <rect x="2" y={y - 1} width="5" height="2" fill="currentColor" />
          <rect x="10" y={y - 2} width="10" height="2" fill="currentColor" opacity="0.55" />
          <rect x="10" y={y + 1.5} width="7" height="1" fill="currentColor" opacity="0.25" />
          {y !== 20 && <line x1="2" y1={y + 4.5} x2="22" y2={y + 4.5} stroke="currentColor" strokeWidth="1" opacity="0.3" />}
        </g>
      ))}
    </svg>
  )
}

/**
 * Hero, display treatment — a vertical rule on the left, three stacked lines of
 * headline stepping in. The step is what distinguishes it from the standard
 * hero at thumbnail size, so it is exaggerated here relative to the real page.
 */
export function HeroDisplayWireframe() {
  return (
    <svg {...BOX} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="3" width="1.5" height="18" fill="currentColor" />
      <rect x="6" y="4" width="6" height="1.5" fill="currentColor" opacity="0.55" />
      <rect x="6" y="8" width="15" height="3" fill="currentColor" />
      <rect x="6" y="12.5" width="12" height="3" fill="currentColor" />
      <rect x="6" y="17" width="9" height="3" fill="currentColor" />
    </svg>
  )
}

/**
 * Feature grid, ordinal treatment — a large numeral sitting above the title
 * inside each card, which is the whole difference from the corner watermark.
 */
export function FeatureGridOrdinalWireframe() {
  return (
    <svg {...BOX} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {[
        [2, 2],
        [12.5, 2],
        [2, 12.5],
        [12.5, 12.5],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="9.5" height="9.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />
          <rect x={x + 1.5} y={y + 1.5} width="3" height="3" fill="currentColor" />
          <rect x={x + 1.5} y={y + 6} width="6.5" height="1.5" fill="currentColor" opacity="0.55" />
        </g>
      ))}
    </svg>
  )
}
