/**
 * ADR-032 slice 6 — the one Archive · Restore · Delete pattern, as data.
 *
 * Every module with the content lifecycle (posts now; events, galleries and
 * the Menu later) builds its ⋯ menu from these rules, so the same state offers
 * the same actions everywhere. The server re-checks every rule (lifecycleGuard);
 * this only decides what is offered.
 *
 *   draft (never published)  → Delete                       (separated, destructive)
 *   scheduled / published    → Unpublish · Set unpublish date · Archive
 *   unpublished              → Publish again · Set unpublish date · Archive
 *   archived                 → Restore · Delete permanently   (separated, destructive; Owner / Site admin)
 *
 * Archive is never destructive (it is reversible); deleting is always last,
 * set apart from the rest.
 */
import type { LifecycleStatus } from '@/lib/lifecycle/status'

export type LifecycleAction = 'unpublish' | 'publishAgain' | 'setUnpublishDate' | 'archive' | 'restore' | 'delete' | 'deletePermanently'

export type LifecycleMenuEntry = { action: LifecycleAction; destructive: boolean; separated: boolean }

export function lifecycleMenu(
  status: LifecycleStatus,
  can: { write: boolean; delete: boolean; deletePublished: boolean }
): LifecycleMenuEntry[] {
  const plain = (action: LifecycleAction): LifecycleMenuEntry => ({ action, destructive: false, separated: false })
  const danger = (action: LifecycleAction): LifecycleMenuEntry => ({ action, destructive: true, separated: true })
  const out: LifecycleMenuEntry[] = []
  if (status === 'draft') {
    if (can.delete) out.push(danger('delete'))
    return out
  }
  if (status === 'archived') {
    if (can.write) out.push(plain('restore'))
    if (can.delete && can.deletePublished) out.push(danger('deletePermanently'))
    return out
  }
  if (!can.write) return out
  out.push(plain(status === 'unpublished' ? 'publishAgain' : 'unpublish'))
  out.push(plain('setUnpublishDate'))
  out.push(plain('archive'))
  return out
}
