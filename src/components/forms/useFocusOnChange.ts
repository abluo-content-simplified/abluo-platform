'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Move keyboard focus to `ref` whenever `key` changes — never on first render.
 *
 * Forms swap their whole body on a step change and on success. The element
 * that had focus (the Continue / Submit button) is unmounted, so focus falls to
 * <body>: outside the dialog, past its focus trap, and nothing is announced.
 * Focusing the new step's heading (or the success message) puts keyboard and
 * screen-reader users where the content changed. The target needs
 * `tabIndex={-1}` to be focusable without entering the Tab order.
 */
export function useFocusOnChange(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
