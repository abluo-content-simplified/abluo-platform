'use client'

import { useEffect, useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps a portalled popover glued to its trigger. The panel is `position:
 * fixed`, placed under the trigger (or above it when there is no room below)
 * from the trigger's `getBoundingClientRect`, and kept inside the viewport.
 * While open it calls `onDismiss` on a press outside trigger + panel, on
 * Escape (`refocus = true`), and on scroll or resize (the anchor moved).
 *
 * Popovers render into the nearest `.abluo-app` (else `document.body`) so the
 * app's scoped theme tokens and light/dark still apply — see `portalTarget`.
 */
export function useAnchoredPopover({
  open,
  anchorRef,
  panelRef,
  align = 'right',
  gap = 4,
  onDismiss,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  align?: 'left' | 'right'
  gap?: number
  onDismiss: (refocus: boolean) => void
}) {
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const margin = 8
    const r = anchor.getBoundingClientRect()
    const w = panel.offsetWidth
    const h = panel.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = r.bottom + gap
    const above = r.top - gap - h
    const top = below + h > vh - margin && above >= margin ? above : below
    const rawLeft = align === 'right' ? r.right - w : r.left
    const left = Math.max(margin, Math.min(rawLeft, vw - w - margin))
    panel.style.top = `${Math.round(top)}px`
    panel.style.left = `${Math.round(left)}px`
    panel.style.visibility = 'visible'
  }, [open, anchorRef, panelRef, align, gap])

  useEffect(() => {
    if (!open) return
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (anchorRef.current?.contains(n) || panelRef.current?.contains(n))
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) onDismiss(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDismiss(true)
      }
    }
    const onMove = (e: Event) => {
      if (e.type === 'scroll' && inside(e.target)) return
      onDismiss(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, anchorRef, panelRef, onDismiss])
}

/** Where popovers portal to: the app root (keeps its theme tokens), else `document.body`. */
export function portalTarget(from: HTMLElement | null): HTMLElement {
  return (from?.closest('.abluo-app') as HTMLElement | null) ?? document.body
}

/** Initial inline style for a portalled panel: fixed, hidden until measured. */
export const FLOATING_STYLE = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' } as const
