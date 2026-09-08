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
 * Max content width comes from the design system's `layout.maxContentWidth`,
 * delivered as `--layout-max-content-width` by the tenant layout. It arrives as
 * a CSS variable rather than a prop on purpose: this component has 31 call
 * sites across 20 files, and threading the design system through every one of
 * them to move one number would be a worse trade than a single custom property
 * emitted once at the root.
 *
 * The `var()` fallback is what makes it safe: a design system that sets nothing
 * emits nothing, and 1120px renders exactly as it did before the token was
 * honoured. Two design systems (No!Logo 1200, the psicoterapia base 1280, which
 * Hoffmann inherits) HAVE been carrying a value that this component previously
 * ignored — those two get wider, which is what they asked for.
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
      <div
        className="mx-auto w-full"
        style={{ maxWidth: 'var(--layout-max-content-width, 1120px)' }}
      >
        {children}
      </div>
    </section>
  )
}
