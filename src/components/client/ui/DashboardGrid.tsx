import type { ReactNode } from 'react'

/**
 * Home's layout primitive (ADR-029 §5), inside PageShell's width.
 *
 * Phone: one column in DOM order (write the children in the phone order).
 * Desktop (lg+): a 12-track grid; each DashboardArea says how many tracks it
 * spans and, when the desktop order differs from the phone order, where it
 * goes (`desktopOrder`). Areas are top-aligned, never stretched to a row.
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-9">{children}</div>
}

const SPAN = { 4: 'lg:col-span-4', 6: 'lg:col-span-6', 8: 'lg:col-span-8', 12: 'lg:col-span-12' } as const
const ORDER = { 1: 'lg:order-1', 2: 'lg:order-2', 3: 'lg:order-3', 4: 'lg:order-4', 5: 'lg:order-5', 6: 'lg:order-6', 7: 'lg:order-7', 8: 'lg:order-8' } as const

export function DashboardArea({
  span = 12,
  desktopOrder,
  children,
  className = '',
}: {
  span?: keyof typeof SPAN
  desktopOrder?: keyof typeof ORDER
  children: ReactNode
  className?: string
}) {
  return <div className={`min-w-0 ${SPAN[span]} ${desktopOrder ? ORDER[desktopOrder] : ''} ${className}`}>{children}</div>
}
