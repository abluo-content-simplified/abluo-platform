'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** How long a sheet/panel takes to slide out (globals.css `--sheet-in`), plus a margin. */
const EXIT_MS = 320

/**
 * Keeps a sheet's last content on screen while it slides out.
 *
 * Callers often render `{open ? <Body/> : null}` or derive the content from a
 * selection that is cleared on close; without this the sheet would slide out
 * empty. While `open`, the live children are shown; after closing, the last
 * open content stays until the exit animation is over, then is dropped (so a
 * closed sheet holds nothing — no stale ids or focusable controls).
 */
export function useExitContent(open: boolean, children: ReactNode): ReactNode {
  const [kept, setKept] = useState<ReactNode>(open ? children : null)
  // Adjusting state during render: remember the content while open.
  if (open && kept !== children) setKept(children)

  useEffect(() => {
    if (open) return
    const id = window.setTimeout(() => setKept(null), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [open])

  return open ? children : kept
}
