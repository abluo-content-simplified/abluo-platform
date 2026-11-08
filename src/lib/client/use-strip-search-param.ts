'use client'

import { useEffect } from 'react'

/**
 * A screen that keeps its search text in local state (not in the address)
 * applies `?q=` / `?open=` from the dashboard search once, then removes the
 * params from the address so a reload or a cleared box never re-applies them.
 * `landed` is the live value of the param; the effect runs whenever it is non-empty.
 */
export function useStripSearchParam(landed: string, keys: string[] = ['q']): void {
  useEffect(() => {
    if (!landed) return
    try {
      const url = new URL(window.location.href)
      let changed = false
      for (const k of keys) if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true }
      if (changed) window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch {
      /* the address stays as it is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per landing
  }, [landed])
}

/** Remove `?open=` from the address (panel closed or the item is not there): no navigation, no scroll jump. */
export function dropOpenFromAddress(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('open')) return
    url.searchParams.delete('open')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    /* the address stays as it is */
  }
}
