'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/**
 * The floating round "+" (3.5rem, bg-action) fixed bottom-right of the
 * viewport on every dashboard page. It is portalled into the `.abluo-app`
 * root (so no ancestor can become its containing block, and the app tokens
 * still apply). It fades out (and drops slightly, 200ms) as soon as the user
 * scrolls — the window or the main scroll container (`#client-main`) — and
 * comes back 1500ms after scrolling stops. Phones: it sits above the bottom
 * tab bar and hides while a list selection is active (the selection panel
 * takes that space).
 *
 * `open`: the Add content panel is open — the "+" turns 45° into an × (the
 * button then closes the panel) and never hides. AddContentSheet renders its
 * own `open` copy inside its dialog (`portal={false}`), at the same spot,
 * so the FAB stays above the panel.
 *
 *   <Fab label="Add content" onPress={() => setAddOpen(true)} />
 */

const REAPPEAR_MS = 1500
export const MAIN_SCROLL_ID = 'client-main'

// A list's selection panel announces itself here (SelectionBar), so the FAB
// can step aside on phones without the two knowing about each other.
let selections = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Mark a selection panel as open while `active` (used by SelectionBar). */
export function useSelectionPresence(active: boolean) {
  useEffect(() => {
    if (!active) return
    selections += 1
    emit()
    return () => {
      selections -= 1
      emit()
    }
  }, [active])
}

const noopSubscribe = () => () => {}
const appRoot = () => document.querySelector<HTMLElement>('.abluo-app')

export function Fab({
  label,
  onPress,
  open = false,
  closeLabel,
  portal = true,
}: {
  label: string
  onPress: () => void
  /** The panel it opens is open: shows × and never hides. */
  open?: boolean
  /** Accessible name while open (defaults to `label`). */
  closeLabel?: string
  /** Portal into the `.abluo-app` root (default). False inside a dialog. */
  portal?: boolean
}) {
  const [scrolling, setScrolling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selecting = useSyncExternalStore(subscribe, () => selections > 0, () => false)
  const root = useSyncExternalStore(noopSubscribe, appRoot, () => null)

  useEffect(() => {
    const onScroll = () => {
      setScrolling(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setScrolling(false), REAPPEAR_MS)
    }
    const main = document.getElementById(MAIN_SCROLL_ID)
    window.addEventListener('scroll', onScroll, { passive: true })
    main?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      main?.removeEventListener('scroll', onScroll)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  // Never hides while its panel is open.
  const hidden = scrolling && !open
  const name = open ? (closeLabel ?? label) : label
  const button = (
    <button
      type="button"
      aria-label={name}
      aria-expanded={open}
      title={name}
      onClick={onPress}
      tabIndex={hidden ? -1 : undefined}
      className={`fixed right-[calc(1.5rem+env(safe-area-inset-right))] bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-action text-action-foreground shadow-[var(--shadow-raise)] transition-[opacity,transform] duration-200 ease-out hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] ${
        hidden ? 'pointer-events-none translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
      } ${selecting && !open ? 'max-md:pointer-events-none max-md:invisible max-md:translate-y-2 max-md:opacity-0' : ''}`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
        className={`transition-transform duration-[280ms] ease-out motion-reduce:transition-none ${open ? 'rotate-45' : 'rotate-0'}`}
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
  if (!portal) return button
  return root ? createPortal(button, root) : null
}
