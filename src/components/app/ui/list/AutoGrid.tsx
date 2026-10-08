import type { HTMLAttributes, ReactNode } from 'react'

export type AutoGridDensity = 'small' | 'medium' | 'large'

/**
 * A grid of same-size tiles (photos, thumbnails, icons) that fills the full
 * content width and adds columns as space allows, left-aligned. Phones get a
 * fixed column count per density; from `sm` up the tiles have a minimum width
 * and the browser fits as many columns as it can (auto-fill).
 *
 *   <AutoGrid density="medium" label="Photos">
 *     {items.map((i) => <li key={i.id}>…</li>)}
 *   </AutoGrid>
 *
 * Renders a <ul>; children should be <li>. Extra props (pointer handlers for
 * pinch-to-zoom, etc.) pass through to the list.
 */
const DENSITY: Record<AutoGridDensity, string> = {
  small: 'grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]',
  medium: 'grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]',
  large: 'grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]',
}

export function AutoGrid({
  density = 'medium',
  label,
  className = '',
  children,
  ...rest
}: {
  density?: AutoGridDensity
  label?: string
  className?: string
  children: ReactNode
} & Omit<HTMLAttributes<HTMLUListElement>, 'className' | 'children' | 'aria-label'>) {
  return (
    <ul aria-label={label} className={`grid items-start gap-2 ${DENSITY[density]} ${className}`} {...rest}>
      {children}
    </ul>
  )
}
