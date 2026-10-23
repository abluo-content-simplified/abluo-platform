'use client'

import { useEffect } from 'react'
import { touchLastSeen } from '@/lib/presence/actions'
import { HEARTBEAT_MS } from '@/lib/presence/model'

/**
 * ADR-030 A1 — tells Abluo this person has a dashboard open, so the admin
 * Users page can show "Active now". Once on open, then every HEARTBEAT_MS
 * while the tab is visible, and again when the tab comes back into view.
 * Renders nothing. A hidden tab sends nothing, so "Active now" means a
 * dashboard someone is actually looking at.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') void touchLastSeen()
    }
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [])
  return null
}
