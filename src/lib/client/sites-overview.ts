/**
 * "Your websites" — the landing page for a person who manages more than one
 * site (Tom, 2026-10-08: "land on an overview of everything, not already on a
 * website"). Pure ordering/selection logic; the page reads the data.
 */

export type SiteCard = {
  projectSlug: string
  name: string
  domain: string | null
  role: string
  /** Unanswered contact requests, or null when the person may not see them / they couldn't be read. */
  openRequests: number | null
  /** New requests in the last 7 days, same rule. */
  newThisWeek: number | null
}

/** One site (or none) → go straight to it; more than one → show the overview. */
export function overviewNeeded(switchableCount: number): boolean {
  return switchableCount > 1
}

/** Sites needing attention first (open requests), then by name. */
export function sortSiteCards<T extends Pick<SiteCard, 'name' | 'openRequests'>>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    const wa = a.openRequests ?? 0
    const wb = b.openRequests ?? 0
    if (wa !== wb) return wb - wa
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
