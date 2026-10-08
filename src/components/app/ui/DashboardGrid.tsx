import type { ReactNode } from 'react'

/**
 * Home's layout primitive (ADR-029 §5), inside PageShell's width.
 *
 * Phone: one column. The order is DOM order unless an area sets `phoneOrder`
 * (needed when a desktop column groups areas that are not neighbours on the
 * phone — see DashboardColumn).
 * Desktop (lg+): a 12-track grid; each DashboardArea says how many tracks it
 * spans and, when the desktop order differs from the phone order, where it
 * goes (`desktopOrder`). Areas are top-aligned, never stretched to a row.
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-9">{children}</div>
}

const SPAN = { 4: 'lg:col-span-4', 6: 'lg:col-span-6', 8: 'lg:col-span-8', 12: 'lg:col-span-12' } as const
const ORDER = { 1: 'lg:order-1', 2: 'lg:order-2', 3: 'lg:order-3', 4: 'lg:order-4', 5: 'lg:order-5', 6: 'lg:order-6', 7: 'lg:order-7', 8: 'lg:order-8' } as const
const PHONE_ORDER = { 1: 'order-1', 2: 'order-2', 3: 'order-3', 4: 'order-4', 5: 'order-5', 6: 'order-6', 7: 'order-7', 8: 'order-8' } as const

export function DashboardArea({
  span = 12,
  desktopOrder,
  phoneOrder,
  children,
  className = '',
}: {
  span?: keyof typeof SPAN
  desktopOrder?: keyof typeof ORDER
  /** Phone position, when it must differ from DOM order. Use on every area of the grid, or on none. */
  phoneOrder?: keyof typeof PHONE_ORDER
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${SPAN[span]} ${phoneOrder ? PHONE_ORDER[phoneOrder] : ''} ${desktopOrder ? ORDER[desktopOrder] : ''} ${className}`}>
      {children}
    </div>
  )
}

/**
 * A desktop column that stacks several areas (e.g. "Needs your attention" with
 * the latest lists under it), so a tall neighbour (Continue editing) does not
 * leave a gap under the shorter one. On phones it disappears (`display:
 * contents`): its children join the page's single column and are placed by
 * their own `phoneOrder`. Inside, desktop order is the children's DOM order.
 */
export function DashboardColumn({
  span = 8,
  desktopOrder,
  children,
}: {
  span?: keyof typeof SPAN
  desktopOrder?: keyof typeof ORDER
  children: ReactNode
}) {
  return (
    <div className={`contents lg:flex lg:min-w-0 lg:flex-col lg:gap-9 ${SPAN[span]} ${desktopOrder ? ORDER[desktopOrder] : ''}`}>
      {children}
    </div>
  )
}
