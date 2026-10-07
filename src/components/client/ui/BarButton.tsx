'use client'

import type { ReactNode } from 'react'

/**
 * The buttons of the floating SelectionBar and of a "More" BottomSheet,
 * shared by every client list page (posts, forms …).
 *
 *   <SelectionBar label="Selection" count="3 selected">
 *     <BarButton icon={ICON} onPress={markDone}>Mark as handled</BarButton>
 *     <BarButton className="md:hidden" icon={MORE} onPress={openMore}>More</BarButton>
 *   </SelectionBar>
 *   <BottomSheet …><SheetItem onPress={…}>Export CSV</SheetItem></BottomSheet>
 */

/** An icon over a short label, 3.5rem tall. `className` e.g. "md:hidden" / "hidden md:flex" — phone and desktop bars differ. */
export function BarButton({
  children,
  icon,
  onPress,
  disabled,
  destructive,
  className = '',
}: {
  children: ReactNode
  icon: ReactNode
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
  /** e.g. "md:hidden" / "hidden md:flex" — phone and desktop bars differ. */
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`${className} flex min-h-14 flex-col items-center justify-start gap-1 rounded-xl px-1 pt-2 pb-1.5 text-xs font-medium hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 ${
        destructive ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

/** One full-width row (3rem) in a sheet's action list. */
export function SheetItem({
  children,
  onPress,
  disabled,
  destructive,
}: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.9375rem] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 ${
        destructive ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
