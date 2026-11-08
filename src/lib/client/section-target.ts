/**
 * Deep links to a section of a dashboard page (`/site/settings#form-notifications`),
 * as used by dashboard search. Pure helpers; the browser side is
 * `components/client/SectionTarget.tsx`.
 */
export const SECTION_TARGET_EVENT = 'abluo:section-target'

/** The section id in an href ("/x/settings?tab=a#form-notifications" → "form-notifications"), or null. */
export function sectionIdFromHref(href: string): string | null {
  const i = href.indexOf('#')
  if (i < 0) return null
  const raw = href.slice(i + 1)
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Tell the page a navigation to `href` was just started. App Router does not
 * fire `hashchange` for a push to the page you are already on, so the caller
 * announces the target itself; SectionTarget then waits for it to render.
 */
export function announceSectionTarget(href: string): void {
  if (typeof window === 'undefined') return
  const id = sectionIdFromHref(href)
  if (id) window.dispatchEvent(new CustomEvent<string>(SECTION_TARGET_EVENT, { detail: id }))
}

/** Same-moment duplicates (event + route change + hashchange for one navigation) collapse into one. */
export function shouldReveal(last: { id: string; at: number } | null, id: string, now: number, windowMs = 600): boolean {
  return !(last && last.id === id && now - last.at < windowMs)
}
