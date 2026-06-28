/**
 * SectionContainer — shared layout wrapper for all non-hero sections.
 *
 * Owns both the outer <section> element (surface styles, anchor id) and the
 * inner content container (centering, max-width, padding). Sections import
 * only this component — no layout constants leak out.
 *
 * Padding scale:
 *   Mobile:  24px horizontal / 72px vertical
 *   Tablet:  40px horizontal / 96px vertical
 *   Desktop: 64px horizontal / 120px vertical
 *
 * TODO: max-width (currently 1120px) should eventually be a Design System
 * layout token so it can be configured per tenant without touching code.
 */

import type { CSSProperties } from 'react'

interface SectionContainerProps {
  children: React.ReactNode
  /** Surface background + text colour variables from getSurfaceStyles() */
  style?: CSSProperties
  /** Optional anchor id (e.g. "trattamenti", "contatti") */
  id?: string
}

export function SectionContainer({ children, style, id }: SectionContainerProps) {
  return (
    <section
      id={id}
      className="px-6 py-[4.5rem] md:px-10 md:py-24 lg:px-16 lg:py-[7.5rem]"
      style={style}
    >
      <div className="mx-auto w-full max-w-[1120px]">
        {children}
      </div>
    </section>
  )
}
