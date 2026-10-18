'use client'

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useExitContent } from './use-exit-content'
import { useSheetDialog } from './use-sheet-dialog'

/**
 * A bare native modal <dialog> with the shared sheet behaviour (portalled into
 * the app root, animated close, Escape routed to `onClose`, last content kept
 * while it exits) but NO chrome: no title bar, no padding, no close button.
 * For overlays BottomSheet / SidePanel cannot be — a full-screen review with
 * its own sticky footer, or a custom panel with a floating button above it.
 * The caller supplies the look through `className` and labels it with
 * `labelledBy` (the id of its heading).
 *
 * `animate` (default true) adds the shared slide / fade (`.app-sheet`); pass
 * false when the content animates itself (the dialog is then just a transparent,
 * top-layer host that stays mounted for the exit).
 *
 *   <DialogFrame open={open} onClose={onKeep} labelledBy="review-title" className="m-0 h-dvh w-full …">
 *     <h2 id="review-title">…</h2>
 *   </DialogFrame>
 */
export function DialogFrame({
  open,
  onClose,
  labelledBy,
  className = '',
  animate = true,
  surface,
  children,
}: {
  open: boolean
  onClose: () => void
  labelledBy: string
  className?: string
  animate?: boolean
  /** Sets `data-surface` (e.g. "create" for the pill buttons). */
  surface?: string
  children: ReactNode
}) {
  const body = useExitContent(open, children)
  const { target, dialogProps } = useSheetDialog(open, onClose)
  if (!target) return null
  return createPortal(
    <dialog {...dialogProps} aria-labelledby={labelledBy} data-surface={surface} className={`${animate ? 'app-sheet ' : ''}${className}`}>
      {body}
    </dialog>,
    target,
  )
}
