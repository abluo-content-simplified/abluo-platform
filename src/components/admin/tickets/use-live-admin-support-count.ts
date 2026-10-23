'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminUnreadCountAction } from '@/app/[locale]/(admin)/support/ticket-actions'
import { useVisibleInterval } from './use-visible-interval'

/**
 * The admin sidebar's Support number, kept live: the layout computes it before
 * a ticket page marks the request read, so it is re-read after every route
 * change and every 30 s while the tab is visible. Any error keeps the last number.
 */
export function useLiveAdminSupportCount(initial: number, pathname: string): number {
  const [count, setCount] = useState(initial)
  // A fresh server value (layout re-rendered after router.refresh) wins.
  useEffect(() => setCount(initial), [initial])
  const refresh = useCallback(async () => {
    try {
      const n = await adminUnreadCountAction()
      if (typeof n === 'number' && Number.isFinite(n)) setCount(n > 0 ? n : 0)
    } catch {
      /* keep the last number */
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh, pathname])
  useVisibleInterval(refresh, 30_000)
  return count
}
