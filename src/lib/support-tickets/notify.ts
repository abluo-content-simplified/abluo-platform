// Server-only.
/**
 * Hook the service calls after every write that may have added an outbox row
 * (create, replies, resolve). Delivery itself (ADR-039 D13, ADR-019 mechanics)
 * lives in ./notifications.ts; the daily sweep re-drives anything missed.
 * Never throws, also outside a request scope (tests, scripts).
 */
import { after } from 'next/server'
import { sweepTicketOutbox } from './notifications'

export function scheduleTicketNotifications(): void {
  try {
    after(async () => {
      try {
        await sweepTicketOutbox(10)
      } catch (err) {
        console.error('[support-tickets] notification sweep failed', err instanceof Error ? err.message : err)
      }
    })
  } catch {
    // No request scope: the daily sweep will pick the row up.
  }
}
