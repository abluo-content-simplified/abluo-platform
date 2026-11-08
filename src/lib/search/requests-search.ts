/**
 * Dashboard search (ADR-047) — contact requests (Supabase form_submissions).
 *
 * v1 reuses the Requests screen's loader (so the gate, the project scoping and
 * the complete/not-spam rules are exactly the screen's) and filters in memory
 * across the sender's name, email and every string value of the submission.
 */
import type { DashboardSubmission } from '@/lib/api/client-dashboard'

export const REQUESTS_SEARCH_SCAN = 500

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 3) return
  if (typeof value === 'string') out.push(value)
  else if (typeof value === 'number') out.push(String(value))
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out, depth + 1)
}

/** Lowercase words of the query (no wildcard — substring match). */
export const requestWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4)

export function filterRequests(rows: readonly DashboardSubmission[], q: string, includeArchived: boolean): DashboardSubmission[] {
  const words = requestWords(q)
  if (!words.length) return []
  return rows.filter((r) => {
    if (r.status === 'archived' && !includeArchived) return false
    const strings: string[] = [r.name ?? '', r.email ?? '']
    collectStrings(r.data, strings)
    const hay = strings.join('\n').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}
