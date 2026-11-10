'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminMessagesUnreadAction } from '@/app/[locale]/(admin)/messages/message-actions'
import { useVisibleInterval } from '@/components/admin/tickets/use-visible-interval'

/** The admin sidebar's Messages number (ADR-050), re-read after every route change and every 60 s while visible. */
export function useLiveAdminMessagesCount(initial: number, pathname: string): number {
  const [count, setCount] = useState(initial)
  useEffect(() => setCount(initial), [initial])
  const refresh = useCallback(async () => {
    try {
      const n = await adminMessagesUnreadAction()
      if (typeof n === 'number' && Number.isFinite(n)) setCount(n > 0 ? n : 0)
    } catch {
      /* keep the last number */
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh, pathname])
  useVisibleInterval(refresh, 60_000)
  return count
}
