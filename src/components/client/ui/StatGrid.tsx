import type { ReactNode } from 'react'

/**
 * A row of StatTiles: two per row on phones, up to four on desktop. Tiles in
 * one row share a height; their content stays top-aligned.
 */
export function StatGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {children}
    </div>
  )
}
