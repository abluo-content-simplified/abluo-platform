'use client'

import type { ComponentProps, ReactNode } from 'react'

/**
 * The pieces of a photo tile in a grid (Media library, gallery photos, the
 * photo picker): the whole-tile button that opens or selects it, and the
 * small labels that sit on the photo ("Used on 2 pages", "Needs a
 * description", a site name). Position labels with className
 * (`absolute bottom-1.5 left-1.5`).
 */
export function TileButton({
  framed = false,
  selected = false,
  className = '',
  type = 'button',
  ...rest
}: {
  /** A square, bordered, rounded tile (the photo picker); unframed fills its parent (a grid cell that already has its frame). */
  framed?: boolean
  /** Framed only: draws the selection ring (pair with aria-pressed). */
  selected?: boolean
} & ComponentProps<'button'>) {
  const frame = framed ? `aspect-square w-full overflow-hidden rounded-xl border bg-muted ${selected ? 'border-ring ring-2 ring-ring' : 'border-border'}` : 'size-full'
  return (
    <button
      type={type}
      className={`block touch-manipulation select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 ${framed ? '' : 'focus-visible:ring-inset'} ${frame} ${className}`}
      {...rest}
    />
  )
}

export function TileLabel({ muted = false, className = '', children }: { muted?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={`pointer-events-none max-w-full truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 ${muted ? 'text-muted-foreground' : 'text-foreground'} ${className}`}>
      {children}
    </span>
  )
}

/** The order number on a picked tile (1, 2, 3…): decorative — the tile's aria-pressed and label carry the meaning. Position with className. */
export function TileBadge({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none flex size-6 items-center justify-center rounded-full border-2 border-background bg-action text-xs font-semibold text-action-foreground ${className}`}
    >
      {children}
    </span>
  )
}
