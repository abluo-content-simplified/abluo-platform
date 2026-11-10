/**
 * The Events list's status filter (ADR-032 A17): All · Draft · Scheduled ·
 * Published · Unpublished · Archived — the same words and rule as Posts.
 * "All" leaves archived events out (archive = put away); the Archived filter
 * shows them. Pure, so the rule is tested without a browser.
 *
 * The status is the event's PUBLICATION state. An event's own status
 * (cancelled, postponed…) and visibility are separate and never filtered here.
 */
import type { LifecycleStatus } from '@/lib/lifecycle/status'

export const EVENT_STATUS_FILTERS = ['draft', 'scheduled', 'published', 'unpublished', 'archived'] as const satisfies readonly LifecycleStatus[]
export type EventStatusFilter = LifecycleStatus | 'all'

export function matchesEventStatus(status: LifecycleStatus, filter: EventStatusFilter): boolean {
  return filter === 'all' ? status !== 'archived' : status === filter
}

/** How many events each filter shows (before the other filters). */
export function eventStatusCounts(items: ReadonlyArray<{ lifecycle: { status: LifecycleStatus } }>): Record<EventStatusFilter, number> {
  const counts: Record<EventStatusFilter, number> = { all: 0, draft: 0, scheduled: 0, published: 0, unpublished: 0, archived: 0 }
  for (const { lifecycle } of items) {
    counts[lifecycle.status] += 1
    if (lifecycle.status !== 'archived') counts.all += 1
  }
  return counts
}
