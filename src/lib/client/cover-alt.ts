/**
 * True when a post has a cover image but no description (alt text) in the
 * site's default language. The wizard shell blocks "Next" on the Cover step
 * while this is true and shows `clientDashboard.create.cover.alt.neededToContinue`
 * (pass `altNeeded` to CoverStep so the message appears on the field).
 *
 * Pure and client-safe: `coverNeedsAlt(draft.cover, site.defaultLocale)`.
 */
export function coverNeedsAlt(
  cover: { alt?: Record<string, string> | null } | null | undefined,
  defaultLocale: string
): boolean {
  return !!cover && !(cover.alt?.[defaultLocale] ?? '').trim()
}
