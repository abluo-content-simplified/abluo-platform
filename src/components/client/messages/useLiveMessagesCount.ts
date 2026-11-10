import { useCallback, useEffect, useState } from 'react'
import { clientMessagesNavAction } from '@/app/[locale]/(client)/[tenant]/messages/message-actions'
import { useVisibleInterval } from '@/components/client/tickets/use-visible-interval'

/**
 * The sidebar's Messages number, kept live like Support's: re-read after every
 * route change (opening a conversation marks it read) and every 60 s while the
 * tab is visible. Any error keeps the last number.
 */
export function useLiveMessagesCount(projectSlug: string, initial: number, pathname: string, enabled: boolean): number {
  const [count, setCount] = useState(initial)
  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const nav = await clientMessagesNavAction(projectSlug)
      setCount(nav && Number.isFinite(nav.unread) && nav.unread > 0 ? nav.unread : 0)
    } catch {
      /* keep the last number */
    }
  }, [projectSlug, enabled])
  useEffect(() => {
    void refresh()
  }, [refresh, pathname])
  useVisibleInterval(refresh, 60_000, enabled)
  return count
}
