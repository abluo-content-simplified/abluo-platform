'use client'

import { useEffect, useRef, useSyncExternalStore, type SyntheticEvent } from 'react'

/** Exit animation length — keep in step with `--sheet-in` in globals.css. */
export const SHEET_EXIT_MS = 280

const noopSubscribe = () => () => {}

/**
 * Shared behaviour of BottomSheet and SidePanel (native modal <dialog>s):
 *
 * • Portalled into the `.abluo-app` root, never left inside the component that
 *   renders it. On iPhones a dialog nested inside the transformed, scrolling
 *   sidebar drawer did not receive taps (Tom, 2026-10-08: the project switcher
 *   "does nothing"); the app root has no transform, and keeps the app's tokens.
 * • Animated close everywhere: the dialog gets `data-closing` (CSS slides it
 *   out), and only after the animation is it really closed. Safari removes a
 *   closed dialog from the screen at once, so CSS alone cannot animate the exit.
 *   Escape is routed through the same path. Reduced motion → closes at once.
 */
export function useSheetDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  const closingByUs = useRef(false)
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const target = mounted ? ((document.querySelector('.abluo-app') as HTMLElement | null) ?? document.body) : null

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open) {
      delete d.dataset.closing
      if (!d.open) d.showModal()
      return
    }
    if (!d.open) return
    const finish = () => {
      closingByUs.current = true
      d.close()
      delete d.dataset.closing
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      return
    }
    d.dataset.closing = ''
    const id = window.setTimeout(finish, SHEET_EXIT_MS)
    return () => window.clearTimeout(id)
  }, [open, target])

  const dialogProps = { ref, ...sheetDialogHandlers(onClose, closingByUs) }
  return { target, dialogProps }
}

/**
 * The cancel/close handlers of a sheet dialog. Pure (exported for tests).
 *
 * React bubbles synthetic events through portals along the COMPONENT tree, so a
 * sheet opened from inside a panel (a DatePicker in a SidePanel) would hand its
 * own cancel/close to the panel too and close both (Tom, 2026-11-02). Only
 * events whose target is THIS dialog count.
 */
export function sheetDialogHandlers(onClose: () => void, closingByUs: { current: boolean }) {
  return {
    // Escape: animate out like any other close, instead of the browser's instant close.
    onCancel: (e: Pick<SyntheticEvent<HTMLDialogElement>, 'target' | 'currentTarget' | 'preventDefault'>) => {
      if (e.target !== e.currentTarget) return
      e.preventDefault()
      onClose()
    },
    // A close we did not start (e.g. a form with method="dialog") still tells the owner.
    onClose: (e: Pick<SyntheticEvent<HTMLDialogElement>, 'target' | 'currentTarget'>) => {
      if (e.target !== e.currentTarget) return
      if (closingByUs.current) {
        closingByUs.current = false
        return
      }
      onClose()
    },
  }
}
