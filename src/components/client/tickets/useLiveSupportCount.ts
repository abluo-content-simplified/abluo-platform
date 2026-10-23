import { useCallback, useEffect, useState } from 'react'
import { clientSupportCountAction } from '@/app/[locale]/(client)/[tenant]/support/ticket-actions'
import { useVisibleInterval } from './use-visible-interval'

/**
 * The sidebar's Support number, kept live: the layout computes it before a
 * ticket page marks the request read, so it is re-read after every route
 * change and every 30 s while the tab is visible. Fail-safe: any error keeps
 * the last number.
 */
export function useLiveSupportCount(projectSlug: string, initial: number, pathname: string, enabled: boolean): number {
  const [count, setCount] = useState(initial)
  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const n = await clientSupportCountAction(projectSlug)
      setCount(Number.isFinite(n) && n > 0 ? n : 0)
    } catch {
      /* keep the last number */
    }
  }, [projectSlug, enabled])
  useEffect(() => {
    void refresh()
  }, [refresh, pathname])
  useVisibleInterval(refresh, 30_000, enabled)
  return count
}
